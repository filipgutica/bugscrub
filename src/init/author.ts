import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import chalk from 'chalk'

import {
  createDisposableWorkspace,
  detectAvailableContainerAgents,
  ensureDockerRuntime,
  runAgentInContainer,
  syncBugscrubWorkspace
} from '../agent-runtime/container.js'
import { runCommand } from '../runner/agent/process.js'
import type { BugScrubConfig } from '../types/index.js'
import { CliError } from '../utils/errors.js'
import { writeTextFile } from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import { promptForChoice } from '../utils/tty-select.js'
import { parseYaml, stringifyYaml } from '../utils/yaml.js'
import { createTranscriptRenderer, renderTranscriptText } from './transcript.js'

export type InitAuthorAgent = 'claude' | 'codex'

export type InitAuthorResult = {
  agent: InitAuthorAgent
  authoredFiles?: string[]
  logPath: string
  stderr: string
  stdout: string
}

type AuthoringWorkspaceConfig = BugScrubConfig & {
  agent: BugScrubConfig['agent'] & {
    preferred: InitAuthorAgent
  }
}

const AUTHORING_STRIPPED_ENV_VARS = [
  'NODE_INSPECT_RESUME_ON_START',
  'NODE_OPTIONS',
  'VSCODE_INSPECTOR_OPTIONS'
] as const

const AUTHORING_ALLOWED_ENV_KEYS = new Set([
  'APPDATA',
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'LOGNAME',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME'
])

const AUTHORING_ALLOWED_ENV_PREFIXES = [
  'ANTHROPIC_',
  'AWS_',
  'CLAUDE_CODE_',
  'CODEX_',
  'OPENAI_'
] as const

const AUTHORING_SENSITIVE_ENV_PATTERNS = [
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /KEY/i
] as const

const AUTHORING_EXCLUDED_NAMES = new Set([
  '.aws',
  '.env',
  '.git',
  '.gnupg',
  '.npmrc',
  '.pnpmrc',
  '.ssh',
  '.terraform',
  '.yarnrc',
  '.yarnrc.yml',
  'id_ed25519',
  'id_rsa',
  'node_modules'
])

const AUTHORING_EXCLUDED_PATTERNS = [
  /^\.env\./i,
  /^service-account.*\.json$/i,
  /\.(?:cer|crt|der|key|kdbx|p12|pem|pfx)$/i
] as const

const MAX_AUTHORING_VALIDATION_ATTEMPTS = 3

const promptForAgentSelection = async ({
  agents
}: {
  agents: InitAuthorAgent[]
}): Promise<InitAuthorAgent> => {
  return promptForChoice({
    choices: agents.map((agent) => ({
      label: chalk.bold(agent),
      value: agent
    })),
    footer: chalk.gray('Use up/down arrows and press Enter.'),
    title: 'Select an authoring agent:'
  })
}

export { renderTranscriptText } from './transcript.js'

const buildValidationFeedbackPrompt = ({
  attempt,
  basePrompt,
  validationMessage
}: {
  attempt: number
  basePrompt: string
  validationMessage: string
}): string => {
  return [
    basePrompt,
    '',
    '# Validation feedback',
    `Your previous authoring pass produced BugScrub files that failed validation on attempt ${attempt}.`,
    'Fix only the reported BugScrub validation issues, preserve unrelated authored work, then stop.',
    'Use `bugscrub schema <type>` if you need the exact schema shape for a file before editing it.',
    '',
    'Validation output:',
    '```',
    validationMessage,
    '```'
  ].join('\n')
}

const detectAvailableAgents = async (): Promise<InitAuthorAgent[]> => {
  return detectAvailableContainerAgents()
}

export const selectAuthoringAgent = async ({
  config,
  promptForSelection = promptForAgentSelection
}: {
  config: BugScrubConfig
  promptForSelection?: (args: { agents: InitAuthorAgent[] }) => Promise<InitAuthorAgent>
}): Promise<{
  agent: InitAuthorAgent
  available: InitAuthorAgent[]
}> => {
  const available = await detectAvailableAgents()

  if (available.length === 0) {
    throw new CliError({
      message: [
        'No supported authoring agent runtime is available.',
        'Detected runtimes: none.',
        'Docker is required, and the selected agent must have either env-based auth or a readable CLI login available.'
      ].join('\n'),
      exitCode: 1
    })
  }

  if (config.agent.preferred !== 'auto') {
    if (!available.includes(config.agent.preferred)) {
      throw new CliError({
        message: [
          `Configured agent "${config.agent.preferred}" is not available.`,
          `Detected runtimes: ${available.join(', ')}.`
        ].join('\n'),
        exitCode: 1
      })
    }

    return {
      agent: config.agent.preferred,
      available
    }
  }

  if (available.length === 1) {
    logger.warn(
      `No preferred authoring agent is configured. Using the only detected runtime: ${available[0]}.`
    )

    return {
      agent: available[0]!,
      available
    }
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({
      message: [
        'Multiple authoring agents are available, but `agent.preferred` is still `auto`.',
        `Detected runtimes: ${available.join(', ')}.`,
        'Set `agent.preferred` in `.bugscrub/bugscrub.config.yaml`, or re-run in an interactive terminal to pick an agent.'
      ].join('\n'),
      exitCode: 1
    })
  }

  logger.warn(
    'No preferred authoring agent is configured. Choose the runtime BugScrub should use for this authoring pass.'
  )

  return {
    agent: await promptForSelection({
      agents: available
    }),
    available
  }
}

const writeAuthoringLog = async ({
  agent,
  cwd,
  env,
  stderr,
  stdout
}: {
  agent: InitAuthorAgent
  cwd: string
  env: NodeJS.ProcessEnv
  stderr: string
  stdout: string
}): Promise<string> => {
  const logPath = join(cwd, '.bugscrub', `authoring-${agent}.log`)
  await writeTextFile({
    path: logPath,
    contents: [
      `# Authoring log (${agent})`,
      '',
      '## stdout',
      stdout.length > 0
        ? redactSensitiveText({
            env,
            text: stdout
          })
        : '(empty)',
      '',
      '## stderr',
      stderr.length > 0
        ? redactSensitiveText({
            env,
            text: stderr
          })
        : '(empty)',
      ''
    ].join('\n')
  })

  return logPath
}

export const redactSensitiveText = ({
  env,
  text
}: {
  env: NodeJS.ProcessEnv
  text: string
}): string => {
  let redacted = text

  for (const [key, value] of Object.entries(env)) {
    if (
      typeof value === 'string' &&
      value.length >= 6 &&
      AUTHORING_SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key))
    ) {
      redacted = redacted.split(value).join(`[REDACTED:${key}]`)
    }
  }

  return redacted
}

export const shouldCopyAuthoringPath = ({
  source
}: {
  source: string
}): boolean => {
  const relativePath = basename(source)

  return (
    !AUTHORING_EXCLUDED_NAMES.has(relativePath) &&
    !AUTHORING_EXCLUDED_PATTERNS.some((pattern) => pattern.test(relativePath))
  )
}

export const createAuthoringEnv = ({
  baseEnv,
  pathPrefix
}: {
  baseEnv?: NodeJS.ProcessEnv
  pathPrefix: string
}): NodeJS.ProcessEnv => {
  const sourceEnv = baseEnv ?? process.env
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (
      value !== undefined &&
      (AUTHORING_ALLOWED_ENV_KEYS.has(key) ||
        AUTHORING_ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)))
    ) {
      env[key] = value
    }
  }

  for (const key of AUTHORING_STRIPPED_ENV_VARS) {
    delete env[key]
  }

  env.PATH = `${pathPrefix}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`

  return env
}

export const pinAuthoringAgentPreference = async ({
  agent,
  tempWorkspaceRoot
}: {
  agent: InitAuthorAgent
  tempWorkspaceRoot: string
}): Promise<void> => {
  const configPath = join(tempWorkspaceRoot, '.bugscrub', 'bugscrub.config.yaml')
  const configSource = await readFile(configPath, 'utf8')
  const parsedConfig = parseYaml<AuthoringWorkspaceConfig>(configSource)

  await writeTextFile({
    path: configPath,
    contents: stringifyYaml({
      ...parsedConfig,
      agent: {
        ...parsedConfig.agent,
        preferred: agent
      }
    })
  })
}

export const syncAuthoredWorkspace = async ({
  cwd,
  tempWorkspaceRoot
}: {
  cwd: string
  tempWorkspaceRoot: string
}): Promise<string[]> => {
  return syncBugscrubWorkspace({
    cwd,
    tempWorkspaceRoot
  })
}

const validateAuthoredWorkspace = async ({
  env,
  tempWorkspaceRoot,
  timeoutSeconds
}: {
  env: NodeJS.ProcessEnv
  tempWorkspaceRoot: string
  timeoutSeconds: number
}): Promise<{
  exitCode: number
  message: string
  stderr: string
  stdout: string
}> => {
  const result = await runCommand({
    args: ['validate'],
    command: 'bugscrub',
    cwd: tempWorkspaceRoot,
    env,
    timeoutMs: timeoutSeconds * 1_000
  })
  const message = [result.stdout.trim(), result.stderr.trim()]
    .filter((value) => value.length > 0)
    .join('\n')

  return {
    exitCode: result.exitCode,
    message: message.length > 0 ? message : 'bugscrub validate exited without output.',
    stderr: result.stderr,
    stdout: result.stdout
  }
}

const runAuthoringAttempt = async ({
  agent,
  prompt,
  sessionRoot,
  tempWorkspaceRoot,
  timeoutSeconds
}: {
  agent: InitAuthorAgent
  prompt: string
  sessionRoot: string
  tempWorkspaceRoot: string
  timeoutSeconds: number
}): Promise<InitAuthorResult> => {
  const renderer = createTranscriptRenderer()
  const result = await runAgentInContainer({
    agent,
    cwd: tempWorkspaceRoot,
    onStderr: (chunk) => {
      renderer.pushStderr(chunk)
    },
    onStdout: (chunk) => {
      renderer.pushStdout(chunk)
    },
    prompt,
    sessionRoot,
    timeoutMs: timeoutSeconds * 1_000
  })
  renderer.flush()

  if (result.exitCode !== 0) {
    throw new CliError({
      message: `${agent === 'codex' ? 'Codex' : 'Claude'} authoring failed with exit code ${result.exitCode}.\n${result.stderr.trim()}`,
      exitCode: 1
    })
  }

  return {
    agent,
    stderr: result.stderr,
    stdout: result.stdout,
    logPath: ''
  }
}

export const authorWorkspace = async ({
  config,
  cwd,
  prompt,
  promptForSelection
}: {
  config: BugScrubConfig
  cwd: string
  prompt: string
  promptForSelection?: (args: { agents: InitAuthorAgent[] }) => Promise<InitAuthorAgent>
}): Promise<InitAuthorResult> => {
  const selectionArgs =
    promptForSelection === undefined
      ? { config }
      : {
          config,
          promptForSelection
        }
  const { agent, available } = await selectAuthoringAgent(selectionArgs)

  logger.info(`Selected authoring agent: ${agent}. Detected runtimes: ${available.join(', ')}.`)
  logger.info(
    `Running ${agent} in an isolated copy of the current directory. Full transcript will be written under .bugscrub/.`
  )

  await ensureDockerRuntime()
  const isolatedWorkspace = await createDisposableWorkspace({
    agent,
    cwd,
    includeNodeModules: false,
    includePackagedBugscrubCli: true
  })
  const aggregatedStdout: string[] = []
  const aggregatedStderr: string[] = []
  let currentPrompt = prompt

  try {
    for (let attempt = 1; attempt <= MAX_AUTHORING_VALIDATION_ATTEMPTS; attempt += 1) {
      logger.info(
        `Authoring attempt ${attempt}/${MAX_AUTHORING_VALIDATION_ATTEMPTS} in the isolated workspace.`
      )

      const attemptResult = await runAuthoringAttempt({
        agent,
        prompt: currentPrompt,
        sessionRoot: isolatedWorkspace.sessionRoot,
        tempWorkspaceRoot: isolatedWorkspace.tempWorkspaceRoot,
        timeoutSeconds: config.agent.timeout
      })

      aggregatedStdout.push(
        `## Authoring attempt ${attempt}\n${attemptResult.stdout.trim() || '(empty)'}`
      )
      aggregatedStderr.push(
        `## Authoring attempt ${attempt}\n${attemptResult.stderr.trim() || '(empty)'}`
      )

      const validationResult = await validateAuthoredWorkspace({
        env: isolatedWorkspace.hostEnv,
        tempWorkspaceRoot: isolatedWorkspace.tempWorkspaceRoot,
        timeoutSeconds: config.agent.timeout
      })

      aggregatedStdout.push(
        `## Validation attempt ${attempt}\n${validationResult.stdout.trim() || '(empty)'}`
      )
      aggregatedStderr.push(
        `## Validation attempt ${attempt}\n${validationResult.stderr.trim() || '(empty)'}`
      )

      if (validationResult.exitCode === 0) {
        const authoredFiles = await syncAuthoredWorkspace({
          cwd,
          tempWorkspaceRoot: isolatedWorkspace.tempWorkspaceRoot
        })

        const logPath = await writeAuthoringLog({
          agent,
          cwd,
          env: isolatedWorkspace.hostEnv,
          stderr: aggregatedStderr.join('\n\n'),
          stdout: aggregatedStdout.join('\n\n')
        })

        return {
          agent,
          authoredFiles,
          logPath,
          stderr: aggregatedStderr.join('\n\n'),
          stdout: aggregatedStdout.join('\n\n')
        }
      }

      if (attempt === MAX_AUTHORING_VALIDATION_ATTEMPTS) {
        throw new CliError({
          message: [
            `Authoring produced invalid BugScrub files after ${MAX_AUTHORING_VALIDATION_ATTEMPTS} attempts.`,
            validationResult.message
          ].join('\n'),
          exitCode: 1
        })
      }

      logger.warn(
        `Authoring attempt ${attempt} failed validation. Feeding the validation errors back to ${agent} for repair.`
      )
      currentPrompt = buildValidationFeedbackPrompt({
        attempt,
        basePrompt: prompt,
        validationMessage: validationResult.message
      })
    }
  } finally {
    await isolatedWorkspace.cleanup()
  }

  throw new CliError({
    message: 'Authoring did not produce a validated BugScrub workspace.',
    exitCode: 1
  })
}
