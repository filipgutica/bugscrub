import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BugScrubConfig } from '../types/index.js'
import { CliError } from '../utils/errors.js'
import { fileExists, writeTextFile } from '../utils/fs.js'
import { resolveInstalledPackageRoot } from '../utils/package-root.js'
import { parseYaml, stringifyYaml } from '../utils/yaml.js'
import { isCommandAvailable, runCommand } from '../runner/agent/process.js'

// Container-backed execution for all agent-invoking flows. This module is
// responsible for preparing a disposable workspace copy, staging auth into a
// writable container home, invoking Docker, and syncing only `.bugscrub/`
// artifacts back to the host repo.
export type ContainerAgent = 'claude' | 'codex'

type WorkspaceConfig = BugScrubConfig & {
  agent: BugScrubConfig['agent'] & {
    preferred: ContainerAgent
  }
}

type ContainerAuth = {
  env: NodeJS.ProcessEnv
}

type DisposableWorkspace = {
  cleanup: () => Promise<void>
  hostEnv: NodeJS.ProcessEnv
  sessionRoot: string
  tempWorkspaceRoot: string
}

const BUGSCRUB_CONTAINER_IMAGE = process.env.BUGSCRUB_CONTAINER_IMAGE ?? 'bugscrub-agent:latest'

const STRIPPED_ENV_VARS = [
  'NODE_INSPECT_RESUME_ON_START',
  'NODE_OPTIONS',
  'VSCODE_INSPECTOR_OPTIONS'
] as const

const BASE_ALLOWED_ENV_KEYS = new Set([
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

const AUTH_ENV_PREFIXES: Record<ContainerAgent, string[]> = {
  claude: ['ANTHROPIC_', 'CLAUDE_CODE_'],
  codex: ['CODEX_', 'OPENAI_']
}

const AUTH_ENV_KEYS: Record<ContainerAgent, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'OPENAI_ACCESS_TOKEN']
}

const EXCLUDED_SOURCE_NAMES = new Set([
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
  'id_rsa'
])

const EXCLUDED_SOURCE_PATTERNS = [
  /^\.env\./i,
  /^service-account.*\.json$/i,
  /\.(?:cer|crt|der|key|kdbx|p12|pem|pfx)$/i
] as const

const AUTH_SOURCE_RELATIVE_PATHS: Record<ContainerAgent, string[]> = {
  claude: ['.claude', '.config/claude', '.config/claude-code'],
  codex: ['.codex', '.config/codex', '.config/openai']
}

const AGENT_HOME_RELATIVE_PATHS: Record<ContainerAgent, string[]> = {
  claude: ['.claude', '.config/claude-code'],
  codex: ['.codex']
}

const DEFAULT_AUTHORING_CLAUDE_MODEL = 'sonnet'
const DEFAULT_AUTHORING_CODEX_MODEL = 'gpt-5.3-codex'

const createSanitizedHostEnv = ({
  baseEnv = process.env
}: {
  baseEnv?: NodeJS.ProcessEnv
} = {}): NodeJS.ProcessEnv => {
  const env = {
    ...baseEnv
  }

  for (const key of STRIPPED_ENV_VARS) {
    delete env[key]
  }

  return env
}

const buildAllowedContainerEnv = ({
  agent,
  baseEnv = process.env
}: {
  agent: ContainerAgent
  baseEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(baseEnv)) {
    if (
      value !== undefined &&
      (BASE_ALLOWED_ENV_KEYS.has(key) ||
        AUTH_ENV_PREFIXES[agent].some((prefix) => key.startsWith(prefix)))
    ) {
      env[key] = value
    }
  }

  for (const key of STRIPPED_ENV_VARS) {
    delete env[key]
  }

  return env
}

const hasAgentEnvAuth = ({
  agent,
  env
}: {
  agent: ContainerAgent
  env: NodeJS.ProcessEnv
}): boolean => {
  return AUTH_ENV_KEYS[agent].some((key) => {
    const value = env[key]
    return typeof value === 'string' && value.length > 0
  })
}

const getCandidateAuthSources = ({
  agent,
  baseEnv = process.env
}: {
  agent: ContainerAgent
  baseEnv?: NodeJS.ProcessEnv
}): Array<{ source: string; targetRelativePath: string }> => {
  const home = baseEnv.HOME ?? homedir()
  const xdgConfigHome = baseEnv.XDG_CONFIG_HOME ?? join(home, '.config')
  const candidates: Array<{ source: string; targetRelativePath: string }> = []

  const explicitHome =
    agent === 'claude'
      ? baseEnv.CLAUDE_CODE_HOME
      : baseEnv.CODEX_HOME

  if (explicitHome) {
    candidates.push({
      source: resolve(explicitHome),
      targetRelativePath: AGENT_HOME_RELATIVE_PATHS[agent][0]!
    })
  }

  for (const relativePath of AUTH_SOURCE_RELATIVE_PATHS[agent]) {
    const source =
      relativePath.startsWith('.config/')
        ? resolve(xdgConfigHome, relativePath.replace(/^\.config\//, ''))
        : resolve(home, relativePath)

    candidates.push({
      source,
      targetRelativePath: relativePath
    })
  }

  return candidates
}

const resolveContainerAuth = async ({
  agent,
  agentHomeDir,
  baseEnv = process.env
}: {
  agent: ContainerAgent
  agentHomeDir: string
  baseEnv?: NodeJS.ProcessEnv
}): Promise<ContainerAuth> => {
  const env = buildAllowedContainerEnv({
    agent,
    baseEnv
  })
  const hasEnvAuth = hasAgentEnvAuth({ agent, env })
  let stagedAuthSource = false

  // CLI-login auth is copied into the disposable container home instead of
  // being mounted read-only because the agent CLIs expect to update caches and
  // session metadata while they run.
  if (!hasEnvAuth) {
    for (const candidate of getCandidateAuthSources({
      agent,
      baseEnv
    })) {
      if (
        await fileExists({
          path: candidate.source
        })
      ) {
        const target = join(agentHomeDir, candidate.targetRelativePath)
        await mkdir(dirname(target), {
          recursive: true
        })
        await rm(target, {
          force: true,
          recursive: true
        })
        await cp(candidate.source, target, {
          recursive: true
        })
        stagedAuthSource = true
      }
    }
  }

  if (!hasEnvAuth && !stagedAuthSource) {
    const authLabel =
      agent === 'codex'
        ? 'OPENAI_/CODEX env vars or a readable Codex CLI auth directory'
        : 'ANTHROPIC_/CLAUDE_CODE_ env vars or a readable Claude CLI auth directory'

    throw new CliError({
      message: [
        `No usable ${agent} authentication source is available for container execution.`,
        `Provide ${authLabel}.`
      ].join('\n'),
      exitCode: 1
    })
  }

  return {
    env
  }
}

export const detectAvailableContainerAgents = async ({
  baseEnv = process.env
}: {
  baseEnv?: NodeJS.ProcessEnv
} = {}): Promise<ContainerAgent[]> => {
  const dockerInstalled = await isCommandAvailable({
    command: 'docker'
  })

  if (!dockerInstalled) {
    return []
  }

  const available: ContainerAgent[] = []

  for (const agent of ['claude', 'codex'] as const) {
    const env = buildAllowedContainerEnv({
      agent,
      baseEnv
    })
    const authCandidates = getCandidateAuthSources({
      agent,
      baseEnv
    })
    const hasAuthMount = (
      await Promise.all(
        authCandidates.map((candidate) =>
          fileExists({
            path: candidate.source
          })
        )
      )
    ).some(Boolean)

    if (hasAgentEnvAuth({ agent, env }) || hasAuthMount) {
      available.push(agent)
    }
  }

  return available
}

export const ensureDockerRuntime = async (): Promise<void> => {
  const dockerInstalled = await isCommandAvailable({
    command: 'docker'
  })

  if (!dockerInstalled) {
    throw new CliError({
      message: [
        'Docker is required for BugScrub agent execution.',
        'Install Docker and ensure the daemon is running before invoking agent-backed commands.'
      ].join('\n'),
      exitCode: 1
    })
  }

  const dockerInfo = await runCommand({
    args: ['info', '--format', '{{json .ServerVersion}}'],
    command: 'docker',
    env: createSanitizedHostEnv(),
    timeoutMs: 10_000
  })

  if (dockerInfo.exitCode !== 0) {
    throw new CliError({
      message: [
        'Docker is required for BugScrub agent execution.',
        dockerInfo.stderr.trim() || dockerInfo.stdout.trim() || 'Docker daemon is unavailable.'
      ].join('\n'),
      exitCode: 1
    })
  }

  const imageInspect = await runCommand({
    args: ['image', 'inspect', BUGSCRUB_CONTAINER_IMAGE],
    command: 'docker',
    env: createSanitizedHostEnv(),
    timeoutMs: 10_000
  })

  if (imageInspect.exitCode !== 0) {
    throw new CliError({
      message: [
        `Required BugScrub agent image "${BUGSCRUB_CONTAINER_IMAGE}" is not available.`,
        'Docker is a requirement of BugScrub. Build or pull the configured image before running agent-backed commands.',
        'Run `bugscrub setup-runtime` once on this machine, or `pnpm docker:build-agent` from the BugScrub repo during local development.'
      ].join('\n'),
      exitCode: 1
    })
  }
}

const shouldCopyWorkspacePath = ({
  includeNodeModules,
  source
}: {
  includeNodeModules: boolean
  source: string
}): boolean => {
  const name = basename(source)

  if (name === 'node_modules' && includeNodeModules) {
    return true
  }

  return (
    !EXCLUDED_SOURCE_NAMES.has(name) &&
    !EXCLUDED_SOURCE_PATTERNS.some((pattern) => pattern.test(name))
  )
}

const createWorkspaceCopy = async ({
  cwd,
  destination,
  includeNodeModules
}: {
  cwd: string
  destination: string
  includeNodeModules: boolean
}): Promise<void> => {
  await cp(cwd, destination, {
    filter: (source) =>
      shouldCopyWorkspacePath({
        includeNodeModules,
        source
      }),
    recursive: true
  })
}

export const createDisposableWorkspace = async ({
  agent,
  cwd,
  includeNodeModules,
  includePackagedBugscrubCli
}: {
  agent: ContainerAgent
  cwd: string
  includeNodeModules: boolean
  includePackagedBugscrubCli: boolean
}): Promise<DisposableWorkspace> => {
  const bugscrubPackageRoot = await resolveInstalledPackageRoot({
    metaUrl: import.meta.url
  })
  // Keep the disposable workspace next to the repo instead of under OS temp.
  // Some Docker runtimes on macOS do not expose `tmpdir()` bind mounts
  // consistently inside the VM, which makes the container see an empty mount.
  const sessionRoot = await mkdtemp(join(dirname(cwd), '.bugscrub-container-'))
  const tempWorkspaceRoot = join(sessionRoot, 'workspace')
  const tempBinRoot = join(sessionRoot, 'bin')
  const tempCliRoot = join(sessionRoot, 'bugscrub-cli')
  const wrapperPath = join(tempBinRoot, 'bugscrub')
  const packagedCliWrapperPath = join(tempCliRoot, 'dist', 'bugscrub')
  const sourceCliEntryPath = join(tempCliRoot, 'src', 'index.ts')
  const hasPackagedCli = await fileExists({
    path: join(bugscrubPackageRoot, 'dist', 'bugscrub')
  })

  await mkdir(tempCliRoot, {
    recursive: true
  })
  await mkdir(join(sessionRoot, 'agent-home', '.config'), {
    recursive: true
  })
  await createWorkspaceCopy({
    cwd,
    destination: tempWorkspaceRoot,
    includeNodeModules
  })

  if (includePackagedBugscrubCli) {
    if (hasPackagedCli) {
      await mkdir(tempBinRoot, {
        recursive: true
      })
    } else {
      await Promise.all([
        cp(join(bugscrubPackageRoot, 'src'), join(tempCliRoot, 'src'), {
          recursive: true
        }),
        cp(join(bugscrubPackageRoot, 'node_modules'), join(tempCliRoot, 'node_modules'), {
          recursive: true
        }),
        writeTextFile({
          path: join(tempCliRoot, 'package.json'),
          contents: JSON.stringify(
            {
              name: 'bugscrub-container-cli',
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
        ? ['#!/bin/sh', `exec "${join(bugscrubPackageRoot, 'dist', 'bugscrub')}" "$@"`].join('\n')
        : [
            '#!/bin/sh',
            `exec node --import "${join(tempCliRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')}" "${sourceCliEntryPath}" "$@"`
          ].join('\n')
    })
    await chmod(wrapperPath, 0o755)

    const configPath = join(tempWorkspaceRoot, '.bugscrub', 'bugscrub.config.yaml')
    const configSource = await readFile(configPath, 'utf8')
    const parsedConfig = parseYaml<WorkspaceConfig>(configSource)

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

  return {
    cleanup: async () => {
      await rm(sessionRoot, {
        force: true,
        recursive: true
      })
    },
    hostEnv: createSanitizedHostEnv({
      baseEnv: includePackagedBugscrubCli
        ? {
            ...process.env,
            PATH: `${tempBinRoot}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`
          }
        : process.env
    }),
    sessionRoot,
    tempWorkspaceRoot
  }
}

export const syncBugscrubWorkspace = async ({
  cwd,
  tempWorkspaceRoot
}: {
  cwd: string
  tempWorkspaceRoot: string
}): Promise<string[]> => {
  // Authoring and run containers are allowed to mutate the disposable repo
  // freely, but only `.bugscrub/` is promoted back to the real host checkout.
  const realBugscrubRoot = join(cwd, '.bugscrub')
  const tempBugscrubRoot = join(tempWorkspaceRoot, '.bugscrub')
  const syncRoot = await mkdtemp(join(cwd, '.bugscrub-sync-'))
  const stagedBugscrubRoot = join(syncRoot, '.bugscrub')
  const backupBugscrubRoot = join(syncRoot, '.bugscrub-backup')

  await cp(tempBugscrubRoot, stagedBugscrubRoot, {
    recursive: true
  })

  const listSyncedFiles = async ({
    root,
    prefix = '.bugscrub'
  }: {
    prefix?: string
    root: string
  }): Promise<string[]> => {
    const entries = await readdir(root, {
      withFileTypes: true
    })
    const results: string[] = []

    for (const entry of entries) {
      const nextPath = join(root, entry.name)
      const nextPrefix = `${prefix}/${entry.name}`

      if (entry.isDirectory()) {
        results.push(
          ...(await listSyncedFiles({
            prefix: nextPrefix,
            root: nextPath
          }))
        )
        continue
      }

      results.push(nextPrefix)
    }

    return results
  }

  const syncedFiles = await listSyncedFiles({
    root: stagedBugscrubRoot
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

  if (movedExistingWorkspace) {
    await rm(backupBugscrubRoot, {
      force: true,
      recursive: true
    })
  }

  await rm(syncRoot, {
    force: true,
    recursive: true
  })

  return syncedFiles
}

const createDockerArgs = async ({
  agent,
  containerArgs,
  sessionRoot,
  timeoutMs,
  workdir
}: {
  agent: ContainerAgent
  containerArgs: string[]
  sessionRoot: string
  timeoutMs: number
  workdir: string
}): Promise<{
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}> => {
  const bugscrubPackageRoot = await resolveInstalledPackageRoot({
    metaUrl: import.meta.url
  })
  const packagedCliWrapperPath = join(sessionRoot, 'bin', 'bugscrub')
  const agentHomeDir = join(sessionRoot, 'agent-home')
  const agentCliHomeDir =
    agent === 'codex'
      ? join(agentHomeDir, '.codex')
      : join(agentHomeDir, '.claude')

  await mkdir(agentCliHomeDir, {
    recursive: true
  })
  const auth = await resolveContainerAuth({
    agent,
    agentHomeDir
  })
  const envArgs = Object.entries({
    ...auth.env,
    ...(agent === 'codex'
      ? {
          CODEX_HOME: agentCliHomeDir
        }
      : {
          CLAUDE_CODE_HOME: agentCliHomeDir
        }),
    HOME: agentHomeDir,
    PATH: `${join(sessionRoot, 'bin')}:${auth.env.PATH ?? process.env.PATH ?? ''}`,
    XDG_CONFIG_HOME: join(agentHomeDir, '.config')
  }).flatMap(([key, value]) => (value === undefined ? [] : ['-e', `${key}=${value}`]))
  const mountArgs = [
    '-v',
    `${sessionRoot}:${sessionRoot}`,
    '-v',
    `${bugscrubPackageRoot}:${bugscrubPackageRoot}:ro`,
    ...(
      await fileExists({
        path: packagedCliWrapperPath
      })
        ? ['-v', `${packagedCliWrapperPath}:/usr/local/bin/bugscrub`]
        : []
    )
  ]

  return {
    args: [
      'run',
      '--rm',
      '--init',
      '-w',
      workdir,
      ...envArgs,
      ...mountArgs,
      BUGSCRUB_CONTAINER_IMAGE,
      ...containerArgs
    ],
    env: createSanitizedHostEnv(),
    timeoutMs
  }
}

const ensureContainerMcpConfigured = async ({
  agent,
  sessionRoot,
  timeoutMs,
  workdir
}: {
  agent: ContainerAgent
  sessionRoot: string
  timeoutMs: number
  workdir: string
}): Promise<void> => {
  const getArgs = await createDockerArgs({
    agent,
    containerArgs: [agent, 'mcp', 'get', 'chrome-devtools'],
    sessionRoot,
    timeoutMs,
    workdir
  })
  const getResult = await runCommand({
    command: 'docker',
    ...getArgs
  })
  const output = `${getResult.stdout}\n${getResult.stderr}`
  const isConfigured =
    output.includes('chrome-devtools') &&
    !/not found|unknown|No MCP server/i.test(output)

  if (isConfigured) {
    return
  }

  const addArgs = await createDockerArgs({
    agent,
    containerArgs:
      agent === 'codex'
        ? [agent, 'mcp', 'add', 'chrome-devtools', '--', 'npx', 'chrome-devtools-mcp@latest']
        : [agent, 'mcp', 'add', 'chrome-devtools', '--scope', 'user', 'npx', 'chrome-devtools-mcp@latest'],
    sessionRoot,
    timeoutMs,
    workdir
  })
  const addResult = await runCommand({
    command: 'docker',
    ...addArgs
  })

  if (addResult.exitCode !== 0) {
    throw new CliError({
      message: [
        `Failed to configure chrome-devtools MCP for ${agent} inside the BugScrub container.`,
        addResult.stderr.trim() || addResult.stdout.trim() || 'Unknown MCP configuration failure.'
      ].join('\n'),
      exitCode: 1
    })
  }
}

export const runAgentInContainer = async ({
  agent,
  cwd,
  onStderr,
  onStdout,
  prompt,
  schemaPath,
  sessionRoot,
  timeoutMs
}: {
  agent: ContainerAgent
  cwd: string
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  prompt: string
  schemaPath?: string
  sessionRoot: string
  timeoutMs: number
}): Promise<{
  exitCode: number
  stderr: string
  stdout: string
}> => {
  if (schemaPath) {
    await ensureContainerMcpConfigured({
      agent,
      sessionRoot,
      timeoutMs,
      workdir: cwd
    })
  }

  const outputMessagePath = join(cwd, '.bugscrub', 'debug', 'codex-last-message.json')
  const containerArgs =
    agent === 'codex'
      ? [
          'codex',
          'exec',
          '--model',
          DEFAULT_AUTHORING_CODEX_MODEL,
          ...(schemaPath
            ? [
                '--json',
                '--sandbox',
                'workspace-write',
                '--output-schema',
                schemaPath,
                '--output-last-message',
                outputMessagePath
              ]
            : ['--sandbox', 'workspace-write', '--skip-git-repo-check']),
          prompt
        ]
      : schemaPath
        ? [
            'claude',
            '--print',
            '--output-format',
            'json',
            '--model',
            DEFAULT_AUTHORING_CLAUDE_MODEL,
            '--json-schema',
            await readFile(schemaPath, 'utf8'),
            '--permission-mode',
            'acceptEdits',
            '--disallowedTools',
            'Edit,MultiEdit,NotebookEdit,Write',
            prompt
          ]
        : [
            'claude',
            '--print',
            '--output-format',
            'text',
            '--model',
            DEFAULT_AUTHORING_CLAUDE_MODEL,
            '--permission-mode',
            'acceptEdits',
            prompt
          ]
  const dockerArgs = await createDockerArgs({
    agent,
    containerArgs,
    sessionRoot,
    timeoutMs,
    workdir: cwd
  })

  return runCommand({
    args: dockerArgs.args,
    command: 'docker',
    env: dockerArgs.env,
    ...(onStderr
      ? {
          onStderr
        }
      : {}),
    ...(onStdout
      ? {
          onStdout
        }
      : {}),
    timeoutMs: dockerArgs.timeoutMs
  })
}

export const remapPath = ({
  fromRoot,
  path,
  toRoot
}: {
  fromRoot: string
  path: string
  toRoot: string
}): string => {
  return join(toRoot, relative(fromRoot, path))
}

export const readCodexLastMessage = async ({
  tempWorkspaceRoot
}: {
  tempWorkspaceRoot: string
}): Promise<string> => {
  return readFile(join(tempWorkspaceRoot, '.bugscrub', 'debug', 'codex-last-message.json'), 'utf8')
}

export const listWorkspaceFiles = async ({
  root
}: {
  root: string
}): Promise<string[]> => {
  const visit = async (currentPath: string): Promise<string[]> => {
    const entries = await readdir(currentPath, {
      withFileTypes: true
    })
    const files: string[] = []

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name)
      const relativePath = relative(root, entryPath).split('\\').join('/')

      if (entry.isDirectory()) {
        files.push(...(await visit(entryPath)))
        continue
      }

      if (entry.isFile()) {
        files.push(relativePath)
      }
    }

    return files
  }

  return visit(root)
}

export const containerInternals = {
  createDockerArgs,
  resolveContainerAuth
}
