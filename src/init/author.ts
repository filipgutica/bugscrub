import { chmod, cp, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import * as readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import chalk from 'chalk'
import type { BugScrubConfig } from '../types/index.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { writeTextFile } from '../utils/fs.js'
import { runCommand, isCommandAvailable } from '../runner/agent/process.js'

export type InitAuthorAgent = 'claude' | 'codex'

export type InitAuthorResult = {
  agent: InitAuthorAgent
  logPath: string
  stderr: string
  stdout: string
}

const AUTHORING_STRIPPED_ENV_VARS = [
  'NODE_INSPECT_RESUME_ON_START',
  'NODE_OPTIONS',
  'VSCODE_INSPECTOR_OPTIONS'
] as const

const promptForAgentSelection = async ({
  agents
}: {
  agents: InitAuthorAgent[]
}): Promise<InitAuthorAgent> => {
  const input = process.stdin
  const output = process.stdout
  let selectedIndex = 0
  let lineCount = 0
  let rendered = false

  const render = (): void => {
    const lines = [
      'Select an authoring agent:',
      ...agents.map((agent, index) =>
        `${index === selectedIndex ? chalk.cyan('>') : ' '} ${index === selectedIndex ? chalk.bold(agent) : agent}`
      ),
      chalk.gray('Use up/down arrows and press Enter.')
    ]

    if (rendered) {
      output.write(`\x1b[${lineCount}F`)
    } else {
      output.write('\x1b[?25l')
    }

    for (const line of lines) {
      output.write(`\x1b[2K${line}\n`)
    }

    lineCount = lines.length
    rendered = true
  }

  try {
    readline.emitKeypressEvents(input)

    if (typeof input.setRawMode === 'function') {
      input.setRawMode(true)
    }

    render()

    return await new Promise<InitAuthorAgent>((resolve, reject) => {
      const onKeypress = (_: string, key: readline.Key): void => {
        if (key.name === 'up') {
          selectedIndex = selectedIndex === 0 ? agents.length - 1 : selectedIndex - 1
          render()
          return
        }

        if (key.name === 'down') {
          selectedIndex = selectedIndex === agents.length - 1 ? 0 : selectedIndex + 1
          render()
          return
        }

        if (key.name === 'return') {
          input.off('keypress', onKeypress)
          resolve(agents[selectedIndex]!)
          return
        }

        if (key.ctrl && key.name === 'c') {
          input.off('keypress', onKeypress)
          reject(
            new CliError({
              message: 'Agent selection was cancelled.',
              exitCode: 1
            })
          )
        }
      }

      input.on('keypress', onKeypress)
    })
  } finally {
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(false)
    }

    if (rendered) {
      output.write(`\x1b[${lineCount}F`)
      for (let index = 0; index < lineCount; index += 1) {
        output.write('\x1b[2K\n')
      }
      output.write(`\x1b[${lineCount}F`)
      output.write('\x1b[?25h')
    }
  }
}

const formatTranscriptLine = ({
  line,
  stderr
}: {
  line: string
  stderr: boolean
}): string => {
  if (line.length === 0) {
    return ''
  }

  const lower = line.toLowerCase()

  if (line === 'codex' || line === 'claude') {
    return chalk.bold.blue(line)
  }

  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('fatal') ||
    lower.startsWith('err:')
  ) {
    return chalk.red(line)
  }

  if (lower.includes('warning') || lower.startsWith('warn:')) {
    return chalk.yellow(line)
  }

  if (stderr) {
    return chalk.gray(line)
  }

  if (line === 'exec' || line === 'file update:' || line === 'tokens used') {
    return chalk.bold.magenta(line)
  }

  if (line.startsWith('diff --git ')) {
    return chalk.bold.yellow(line)
  }

  if (line.startsWith('+++ ')) {
    return chalk.green(line)
  }

  if (line.startsWith('--- ')) {
    return chalk.red(line)
  }

  if (line.startsWith('@@')) {
    return chalk.cyan(line)
  }

  if (line.startsWith('+') && !line.startsWith('+++')) {
    return chalk.green(line)
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return chalk.red(line)
  }

  if (line.startsWith('# ')) {
    return chalk.bold.cyan(line)
  }

  if (line.startsWith('## ') || line.startsWith('### ')) {
    return chalk.bold(line)
  }

  if (line.startsWith('bugscrub ')) {
    return `${chalk.blue('bugscrub')} ${line.slice('bugscrub '.length)}`
  }

  if (line.startsWith('/bin/') || line.startsWith('.bugscrub/') || line.startsWith('index ')) {
    return chalk.gray(line)
  }

  return line
}

const createTranscriptRenderer = () => {
  let stdoutBuffer = ''
  let stderrBuffer = ''

  const flushBuffer = ({
    buffer,
    stderr
  }: {
    buffer: string
    stderr: boolean
  }): string => {
    const lines = buffer.split('\n')
    const remainder = lines.pop() ?? ''

    for (const line of lines) {
      const formatted = formatTranscriptLine({
        line,
        stderr
      })
      const stream = stderr ? process.stderr : process.stdout
      stream.write(`${formatted}\n`)
    }

    return remainder
  }

  return {
    flush: (): void => {
      if (stdoutBuffer.length > 0) {
        process.stdout.write(
          `${formatTranscriptLine({
            line: stdoutBuffer,
            stderr: false
          })}\n`
        )
        stdoutBuffer = ''
      }

      if (stderrBuffer.length > 0) {
        process.stderr.write(
          `${formatTranscriptLine({
            line: stderrBuffer,
            stderr: true
          })}\n`
        )
        stderrBuffer = ''
      }
    },
    pushStderr: (chunk: string): void => {
      stderrBuffer += chunk
      stderrBuffer = flushBuffer({
        buffer: stderrBuffer,
        stderr: true
      })
    },
    pushStdout: (chunk: string): void => {
      stdoutBuffer += chunk
      stdoutBuffer = flushBuffer({
        buffer: stdoutBuffer,
        stderr: false
      })
    }
  }
}

const detectAvailableAgents = async (): Promise<InitAuthorAgent[]> => {
  const [hasClaude, hasCodex] = await Promise.all([
    isCommandAvailable({
      command: 'claude'
    }),
    isCommandAvailable({
      command: 'codex'
    })
  ])

  return [
    ...(hasClaude ? (['claude'] as const) : []),
    ...(hasCodex ? (['codex'] as const) : [])
  ]
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
        'Install `claude` or `codex`, or update `agent.preferred` in `.bugscrub/bugscrub.config.yaml`.'
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
  stderr,
  stdout
}: {
  agent: InitAuthorAgent
  cwd: string
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
      stdout.length > 0 ? stdout : '(empty)',
      '',
      '## stderr',
      stderr.length > 0 ? stderr : '(empty)',
      ''
    ].join('\n')
  })

  return logPath
}

const copyFilter = (source: string): boolean => {
  const relativePath = basename(source)
  return relativePath !== '.git' && relativePath !== 'node_modules'
}

export const createAuthoringEnv = ({
  baseEnv,
  pathPrefix
}: {
  baseEnv?: NodeJS.ProcessEnv
  pathPrefix: string
}): NodeJS.ProcessEnv => {
  const env = {
    ...(baseEnv ?? process.env)
  }

  for (const key of AUTHORING_STRIPPED_ENV_VARS) {
    delete env[key]
  }

  env.PATH = `${pathPrefix}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`

  return env
}

const createIsolatedWorkspace = async ({
  cwd
}: {
  cwd: string
}): Promise<{
  cleanup: () => Promise<void>
  env: NodeJS.ProcessEnv
  tempWorkspaceRoot: string
}> => {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'bugscrub-author-'))
  const tempWorkspaceRoot = join(sessionRoot, 'workspace')
  const tempBinRoot = join(sessionRoot, 'bin')
  const cliEntryPath = fileURLToPath(new URL('../index.ts', import.meta.url))
  const tsxImportPath = fileURLToPath(import.meta.resolve('tsx'))
  const wrapperPath = join(tempBinRoot, 'bugscrub')

  await cp(cwd, tempWorkspaceRoot, {
    filter: copyFilter,
    recursive: true
  })
  await writeTextFile({
    path: wrapperPath,
    contents: [
      '#!/bin/sh',
      `exec node --import "${tsxImportPath}" "${cliEntryPath}" "$@"`
    ].join('\n')
  })
  await chmod(wrapperPath, 0o755)

  return {
    cleanup: async () => {
      await rm(sessionRoot, {
        force: true,
        recursive: true
      })
    },
    env: createAuthoringEnv({
      pathPrefix: tempBinRoot
    }),
    tempWorkspaceRoot
  }
}

export const syncAuthoredWorkspace = async ({
  cwd,
  tempWorkspaceRoot
}: {
  cwd: string
  tempWorkspaceRoot: string
}): Promise<void> => {
  const realBugscrubRoot = join(cwd, '.bugscrub')
  const tempBugscrubRoot = join(tempWorkspaceRoot, '.bugscrub')
  const syncRoot = await mkdtemp(join(cwd, '.bugscrub-sync-'))
  const stagedBugscrubRoot = join(syncRoot, '.bugscrub')
  const backupBugscrubRoot = join(syncRoot, '.bugscrub-backup')

  await cp(tempBugscrubRoot, stagedBugscrubRoot, {
    recursive: true
  })

  let movedExistingWorkspace = false

  try {
    await rename(realBugscrubRoot, backupBugscrubRoot)
    movedExistingWorkspace = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await rm(syncRoot, {
        force: true,
        recursive: true
      })
      throw error
    }
  }

  try {
    await rename(stagedBugscrubRoot, realBugscrubRoot)
  } catch (error) {
    if (movedExistingWorkspace) {
      await rename(backupBugscrubRoot, realBugscrubRoot)
    }

    await rm(syncRoot, {
      force: true,
      recursive: true
    })
    throw error
  }

  await rm(syncRoot, {
    force: true,
    recursive: true
  })
}

const runCodexAuthoring = async ({
  cwd,
  prompt,
  timeoutSeconds
}: {
  cwd: string
  prompt: string
  timeoutSeconds: number
}): Promise<InitAuthorResult> => {
  const isolatedWorkspace = await createIsolatedWorkspace({
    cwd
  })
  const renderer = createTranscriptRenderer()
  let result: Awaited<ReturnType<typeof runCommand>> | undefined

  try {
    result = await runCommand({
      args: ['exec', '--full-auto', '--skip-git-repo-check', prompt],
      command: 'codex',
      cwd: isolatedWorkspace.tempWorkspaceRoot,
      env: isolatedWorkspace.env,
      onStderr: (chunk) => {
        renderer.pushStderr(chunk)
      },
      onStdout: (chunk) => {
        renderer.pushStdout(chunk)
      },
      timeoutMs: timeoutSeconds * 1_000
    })
    renderer.flush()

    if (result.exitCode !== 0) {
      throw new CliError({
        message: `Codex authoring failed with exit code ${result.exitCode}.\n${result.stderr.trim()}`,
        exitCode: 1
      })
    }

    await syncAuthoredWorkspace({
      cwd,
      tempWorkspaceRoot: isolatedWorkspace.tempWorkspaceRoot
    })
  } finally {
    await isolatedWorkspace.cleanup()
  }

  if (!result) {
    throw new CliError({
      message: 'Codex authoring did not produce a result.',
      exitCode: 1
    })
  }

  const logPath = await writeAuthoringLog({
    agent: 'codex',
    cwd,
    stderr: result.stderr,
    stdout: result.stdout
  })

  return {
    agent: 'codex',
    logPath,
    stderr: result.stderr,
    stdout: result.stdout
  }
}

const runClaudeAuthoring = async ({
  allowDangerousPermissions,
  cwd,
  maxBudgetUsd,
  prompt,
  timeoutSeconds
}: {
  allowDangerousPermissions: boolean | undefined
  cwd: string
  maxBudgetUsd: number
  prompt: string
  timeoutSeconds: number
}): Promise<InitAuthorResult> => {
  const isolatedWorkspace = await createIsolatedWorkspace({
    cwd
  })
  const renderer = createTranscriptRenderer()
  let result: Awaited<ReturnType<typeof runCommand>> | undefined

  try {
    result = await runCommand({
      args: [
        '--print',
        '--output-format',
        'text',
        '--permission-mode',
        allowDangerousPermissions ? 'bypassPermissions' : 'acceptEdits',
        '--max-budget-usd',
        String(maxBudgetUsd),
        prompt
      ],
      command: 'claude',
      cwd: isolatedWorkspace.tempWorkspaceRoot,
      env: isolatedWorkspace.env,
      onStderr: (chunk) => {
        renderer.pushStderr(chunk)
      },
      onStdout: (chunk) => {
        renderer.pushStdout(chunk)
      },
      timeoutMs: timeoutSeconds * 1_000
    })
    renderer.flush()

    if (result.exitCode !== 0) {
      throw new CliError({
        message: `Claude authoring failed with exit code ${result.exitCode}.\n${result.stderr.trim()}`,
        exitCode: 1
      })
    }

    await syncAuthoredWorkspace({
      cwd,
      tempWorkspaceRoot: isolatedWorkspace.tempWorkspaceRoot
    })
  } finally {
    await isolatedWorkspace.cleanup()
  }

  if (!result) {
    throw new CliError({
      message: 'Claude authoring did not produce a result.',
      exitCode: 1
    })
  }

  const logPath = await writeAuthoringLog({
    agent: 'claude',
    cwd,
    stderr: result.stderr,
    stdout: result.stdout
  })

  return {
    agent: 'claude',
    logPath,
    stderr: result.stderr,
    stdout: result.stdout
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

  if (agent === 'codex') {
    return runCodexAuthoring({
      cwd,
      prompt,
      timeoutSeconds: config.agent.timeout
    })
  }

  return runClaudeAuthoring({
    allowDangerousPermissions: config.agent.allowDangerousPermissions,
    cwd,
    maxBudgetUsd: config.agent.maxBudgetUsd,
    prompt,
    timeoutSeconds: config.agent.timeout
  })
}
