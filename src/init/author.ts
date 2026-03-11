import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import chalk from 'chalk'
import type { BugScrubConfig } from '../types/index.js'
import { CliError } from '../utils/errors.js'
import { parseYaml, stringifyYaml } from '../utils/yaml.js'
import {
  getTerminalWidth,
  logger,
  wrapTerminalText
} from '../utils/logger.js'
import { fileExists, writeTextFile } from '../utils/fs.js'
import { promptForChoice } from '../utils/tty-select.js'
import { runCommand, isCommandAvailable } from '../runner/agent/process.js'

// Authoring runs the selected agent in an isolated workspace and streams a readable transcript.
export type InitAuthorAgent = 'claude' | 'codex'

export type InitAuthorResult = {
  agent: InitAuthorAgent
  logPath: string
  stderr: string
  stdout: string
}

const BUGSCRUB_PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))

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

const NOISY_DIFF_FILE_PATTERNS = [
  /(?:^|\/)(?:dist|build|coverage)\//i,
  /\.(?:map|min\.(?:css|js))$/i,
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i
] as const

type TranscriptFormattingState = {
  collapsedNoisyDiff: boolean
  currentDiffFile: string | undefined
  inCodeBlock: boolean
}

// Authoring is synthesis-heavy but still routine enough that we should not pay top-tier
// model cost by default. Use the mainstream coding tiers unless we later expose a user
// override with clearer product semantics.
const DEFAULT_AUTHORING_CLAUDE_MODEL = 'sonnet'
const DEFAULT_AUTHORING_CODEX_MODEL = 'gpt-5.3-codex'

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

const isNoisyDiffFile = ({
  path
}: {
  path: string | undefined
}): boolean => {
  return path
    ? NOISY_DIFF_FILE_PATTERNS.some((pattern) => pattern.test(path))
    : false
}

const looksGeneratedOrMinified = ({
  line,
  width
}: {
  line: string
  width: number
}): boolean => {
  if (line.length < width * 2) {
    return false
  }

  const whitespaceCount = [...line].filter((character) => /\s/.test(character)).length
  const punctuationCount = [...line].filter((character) =>
    /[{}()[\].,;:=<>/+*-]/.test(character)
  ).length

  return whitespaceCount < line.length / 20 && punctuationCount >= 8
}

const truncateDisplayLine = ({
  line,
  width
}: {
  line: string
  width: number
}): string => {
  const previewWidth = Math.max(24, width - ' ... [truncated for display]'.length)

  if (line.length <= previewWidth) {
    return line
  }

  return `${line.slice(0, previewWidth).trimEnd()} ... [truncated for display]`
}

const wrapStyledText = ({
  hangingIndent = '',
  initialIndent = '',
  style,
  text,
  width
}: {
  hangingIndent?: string
  initialIndent?: string
  style: (value: string) => string
  text: string
  width: number
}): string[] => {
  return wrapTerminalText({
    hangingIndent,
    initialIndent,
    text,
    width
  }).map((segment) => style(segment))
}

const createTranscriptFormattingState = (): TranscriptFormattingState => ({
  collapsedNoisyDiff: false,
  currentDiffFile: undefined,
  inCodeBlock: false
})

export const createTranscriptFormatter = ({
  width = getTerminalWidth()
}: {
  width?: number
} = {}) => {
  const state = createTranscriptFormattingState()

  const formatLine = ({
    line,
    stderr
  }: {
    line: string
    stderr: boolean
  }): string[] => {
    if (line.length === 0) {
      return ['']
    }

    const diffHeaderMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)

    if (diffHeaderMatch) {
      state.currentDiffFile = diffHeaderMatch[2]
      state.collapsedNoisyDiff = false
      return wrapStyledText({
        style: chalk.bold.yellow,
        text: line,
        width
      })
    }

    const isNoisyDiff = isNoisyDiffFile({
      path: state.currentDiffFile
    })

    if (line.trim().startsWith('```')) {
      state.inCodeBlock = !state.inCodeBlock
      return wrapStyledText({
        style: chalk.gray,
        text: line.trim(),
        width
      })
    }

    if (
      isNoisyDiff &&
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      // Generated bundles and lockfiles are useful to log, but not useful to stream verbatim.
      if (state.collapsedNoisyDiff) {
        return []
      }

      state.collapsedNoisyDiff = true
      return [
        chalk.gray(`... generated diff content for ${state.currentDiffFile} truncated for display`)
      ]
    }

    const lower = line.toLowerCase()

    if (line === 'codex' || line === 'claude') {
      return wrapStyledText({
        style: chalk.bold.blue,
        text: line,
        width
      })
    }

    if (
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes('fatal') ||
      lower.startsWith('err:')
    ) {
      return wrapStyledText({
        style: chalk.red,
        text: line,
        width
      })
    }

    if (lower.includes('warning') || lower.startsWith('warn:')) {
      return wrapStyledText({
        style: chalk.yellow,
        text: line,
        width
      })
    }

    if (stderr) {
      return wrapStyledText({
        style: chalk.gray,
        text:
          looksGeneratedOrMinified({
            line,
            width
          })
            ? truncateDisplayLine({
                line,
                width
              })
            : line,
        width
      })
    }

    if (line === 'exec' || line === 'file update:' || line === 'tokens used') {
      return wrapStyledText({
        style: chalk.bold.magenta,
        text: line,
        width
      })
    }

    if (line.startsWith('+++ ')) {
      return wrapStyledText({
        style: chalk.green,
        text: line,
        width
      })
    }

    if (line.startsWith('--- ')) {
      return wrapStyledText({
        style: chalk.red,
        text: line,
        width
      })
    }

    if (line.startsWith('@@')) {
      return wrapStyledText({
        style: chalk.cyan,
        text: line,
        width
      })
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      return wrapStyledText({
        hangingIndent: ' ',
        initialIndent: '+',
        style: chalk.green,
        text: looksGeneratedOrMinified({
          line,
          width
        })
          ? truncateDisplayLine({
              line: line.slice(1),
              width
            })
          : line.slice(1),
        width
      })
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      return wrapStyledText({
        hangingIndent: ' ',
        initialIndent: '-',
        style: chalk.red,
        text: looksGeneratedOrMinified({
          line,
          width
        })
          ? truncateDisplayLine({
              line: line.slice(1),
              width
            })
          : line.slice(1),
        width
      })
    }

    if (line.startsWith('# ')) {
      return wrapStyledText({
        style: chalk.bold.cyan,
        text: line,
        width
      })
    }

    if (line.startsWith('## ') || line.startsWith('### ')) {
      return wrapStyledText({
        style: chalk.bold,
        text: line,
        width
      })
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      return wrapStyledText({
        hangingIndent: '  ',
        initialIndent: `${line[0]} `,
        style: (value) => value,
        text: line.slice(2),
        width
      })
    }

    if (/^\d+\.\s/.test(line)) {
      const marker = line.match(/^\d+\.\s/)?.[0] ?? ''
      return wrapStyledText({
        hangingIndent: ' '.repeat(marker.length),
        initialIndent: marker,
        style: (value) => value,
        text: line.slice(marker.length),
        width
      })
    }

    if (line.startsWith('bugscrub ')) {
      const wrapped = wrapTerminalText({
        hangingIndent: '         ',
        initialIndent: '',
        text: line.slice('bugscrub '.length),
        width: width - 'bugscrub '.length
      })

      return wrapped.map((segment, index) =>
        index === 0 ? `${chalk.blue('bugscrub')} ${segment}` : `         ${segment}`
      )
    }

    if (state.inCodeBlock) {
      return wrapStyledText({
        hangingIndent: '  ',
        initialIndent: '  ',
        style: chalk.gray,
        text: line,
        width
      })
    }

    if (line.startsWith('/bin/') || line.startsWith('.bugscrub/') || line.startsWith('index ')) {
      return wrapStyledText({
        style: chalk.gray,
        text: line,
        width
      })
    }

    return wrapStyledText({
      style: (value) => value,
      text:
        looksGeneratedOrMinified({
          line,
          width
        })
          ? truncateDisplayLine({
              line,
              width
            })
          : line,
      width
    })
  }

  return {
    formatLine
  }
}

export const renderTranscriptText = ({
  stderr,
  text,
  width
}: {
  stderr: boolean
  text: string
  width?: number
}): string => {
  const formatter = createTranscriptFormatter({
    ...(width ? { width } : {})
  })

  return text
    .split('\n')
    .flatMap((line) =>
      formatter.formatLine({
        line,
        stderr
      })
    )
    .join('\n')
}

const createTranscriptRenderer = () => {
  const formatter = createTranscriptFormatter()
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
      const stream = stderr ? process.stderr : process.stdout
      formatter
        .formatLine({
          line,
          stderr
        })
        .forEach((formatted) => {
          stream.write(`${formatted}\n`)
        })
    }

    return remainder
  }

  return {
    flush: (): void => {
      if (stdoutBuffer.length > 0) {
        formatter
          .formatLine({
            line: stdoutBuffer,
            stderr: false
          })
          .forEach((formatted) => {
            process.stdout.write(`${formatted}\n`)
          })
        stdoutBuffer = ''
      }

      if (stderrBuffer.length > 0) {
        formatter
          .formatLine({
            line: stderrBuffer,
            stderr: true
          })
          .forEach((formatted) => {
            process.stderr.write(`${formatted}\n`)
          })
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

const copyFilter = (source: string): boolean => {
  return shouldCopyAuthoringPath({
    source
  })
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

  // Keep the subprocess environment intentionally small so agent runs do not inherit
  // unrelated local secrets or shell configuration by default.
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

const createIsolatedWorkspace = async ({
  agent,
  cwd
}: {
  agent: InitAuthorAgent
  cwd: string
}): Promise<{
  cleanup: () => Promise<void>
  env: NodeJS.ProcessEnv
  tempWorkspaceRoot: string
}> => {
  const sessionRoot = await mkdtemp(join(tmpdir(), 'bugscrub-author-'))
  const tempWorkspaceRoot = join(sessionRoot, 'workspace')
  const tempBinRoot = join(sessionRoot, 'bin')
  const tempCliRoot = join(sessionRoot, 'bugscrub-cli')
  const wrapperPath = join(tempBinRoot, 'bugscrub')
  const packagedCliEntryPath = join(tempCliRoot, 'dist', 'index.js')
  const sourceCliEntryPath = join(tempCliRoot, 'src', 'index.ts')
  const hasPackagedCli = await fileExists({
    path: join(BUGSCRUB_PROJECT_ROOT, 'dist', 'index.js')
  })

  await mkdir(tempCliRoot, {
    recursive: true
  })
  await cp(cwd, tempWorkspaceRoot, {
    filter: copyFilter,
    recursive: true
  })
  await symlink(join(BUGSCRUB_PROJECT_ROOT, 'node_modules'), join(tempCliRoot, 'node_modules'))

  if (hasPackagedCli) {
    await Promise.all([
      cp(join(BUGSCRUB_PROJECT_ROOT, 'dist'), join(tempCliRoot, 'dist'), {
        recursive: true
      }),
      cp(join(BUGSCRUB_PROJECT_ROOT, 'package.json'), join(tempCliRoot, 'package.json'))
    ])
  } else {
    await Promise.all([
      cp(join(BUGSCRUB_PROJECT_ROOT, 'src'), join(tempCliRoot, 'src'), {
        recursive: true
      }),
      writeTextFile({
        path: join(tempCliRoot, 'package.json'),
        contents: JSON.stringify(
          {
            name: 'bugscrub-authoring-cli',
            private: true,
            type: 'module'
          },
          null,
          2
        )
      })
    ])
  }

  await writeTextFile({
    path: wrapperPath,
    contents: hasPackagedCli
      ? ['#!/bin/sh', `exec node "${packagedCliEntryPath}" "$@"`].join('\n')
      : [
          '#!/bin/sh',
          `exec node --import "${join(tempCliRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')}" "${sourceCliEntryPath}" "$@"`
        ].join('\n')
  })
  await chmod(wrapperPath, 0o755)
  await pinAuthoringAgentPreference({
    agent,
    tempWorkspaceRoot
  })

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

const listScopedAuthoringFiles = async ({
  includeExcludedSourceFiles = false,
  root
}: {
  includeExcludedSourceFiles?: boolean
  root: string
}): Promise<string[]> => {
  const visit = async ({
    currentPath
  }: {
    currentPath: string
  }): Promise<string[]> => {
    const entries = await readdir(currentPath, {
      withFileTypes: true
    })
    const files: string[] = []

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name)
      const relativePath = relative(root, entryPath).split('\\').join('/')

      if (relativePath === '.bugscrub' || relativePath.startsWith('.bugscrub/')) {
        continue
      }

      if (!includeExcludedSourceFiles && !shouldCopyAuthoringPath({ source: entryPath })) {
        continue
      }

      if (entry.isDirectory()) {
        files.push(
          ...(await visit({
            currentPath: entryPath
          }))
        )
        continue
      }

      if (entry.isFile()) {
        files.push(relativePath)
      }
    }

    return files
  }

  return visit({
    currentPath: root
  })
}

const assertScopedAuthoringChanges = async ({
  cwd,
  tempWorkspaceRoot
}: {
  cwd: string
  tempWorkspaceRoot: string
}): Promise<void> => {
  const [sourceFiles, authoredFiles] = await Promise.all([
    listScopedAuthoringFiles({
      root: cwd
    }),
    listScopedAuthoringFiles({
      includeExcludedSourceFiles: true,
      root: tempWorkspaceRoot
    })
  ])
  const sourceSet = new Set(sourceFiles)
  const authoredSet = new Set(authoredFiles)
  const candidatePaths = [...new Set([...sourceFiles, ...authoredFiles])].sort((left, right) =>
    left.localeCompare(right)
  )
  const unexpectedChanges: string[] = []

  for (const candidatePath of candidatePaths) {
    if (!sourceSet.has(candidatePath) || !authoredSet.has(candidatePath)) {
      unexpectedChanges.push(candidatePath)
      continue
    }

    const [sourceContents, authoredContents] = await Promise.all([
      readFile(join(cwd, candidatePath), 'utf8'),
      readFile(join(tempWorkspaceRoot, candidatePath), 'utf8')
    ])

    if (sourceContents !== authoredContents) {
      unexpectedChanges.push(candidatePath)
    }
  }

  if (unexpectedChanges.length > 0) {
    throw new CliError({
      message: [
        'Authoring agents may inspect the repo, but BugScrub only accepts changes under `.bugscrub/`.',
        'Unexpected edits were detected outside `.bugscrub/`:',
        ...unexpectedChanges.map((path) => `- ${path}`)
      ].join('\n'),
      exitCode: 1
    })
  }
}

export const syncAuthoredWorkspace = async ({
  cwd,
  tempWorkspaceRoot
}: {
  cwd: string
  tempWorkspaceRoot: string
}): Promise<void> => {
  await assertScopedAuthoringChanges({
    cwd,
    tempWorkspaceRoot
  })

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
    agent: 'codex',
    cwd
  })
  const renderer = createTranscriptRenderer()
  let result: Awaited<ReturnType<typeof runCommand>> | undefined

  try {
    result = await runCommand({
      args: [
        'exec',
        '--model',
        DEFAULT_AUTHORING_CODEX_MODEL,
        '--sandbox',
        'workspace-write',
        '--skip-git-repo-check',
        prompt
      ],
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
    env: isolatedWorkspace.env,
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
  cwd,
  maxBudgetUsd,
  prompt,
  timeoutSeconds
}: {
  cwd: string
  maxBudgetUsd: number
  prompt: string
  timeoutSeconds: number
}): Promise<InitAuthorResult> => {
  const isolatedWorkspace = await createIsolatedWorkspace({
    agent: 'claude',
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
        '--model',
        DEFAULT_AUTHORING_CLAUDE_MODEL,
        '--permission-mode',
        'acceptEdits',
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
    env: isolatedWorkspace.env,
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
    cwd,
    maxBudgetUsd: config.agent.maxBudgetUsd,
    prompt,
    timeoutSeconds: config.agent.timeout
  })
}
