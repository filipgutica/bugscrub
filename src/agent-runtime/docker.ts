import { mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { CliError } from '../utils/errors.js'
import { fileExists } from '../utils/fs.js'
import { resolveInstalledPackageRoot } from '../utils/package-root.js'
import { isCommandAvailable, runCommand } from '../runner/agent/process.js'
import { resolveContainerAuth } from './auth.js'
import {
  AGENT_HOME_RELATIVE_PATHS,
  BUGSCRUB_CONTAINER_IMAGE,
  createSanitizedHostEnv,
  type ContainerAgent,
  type ContainerExecutionTarget,
  DEFAULT_AUTHORING_CLAUDE_MODEL,
  DEFAULT_AUTHORING_CODEX_MODEL,
  DEFAULT_SESSION_CONTAINER_COMMAND
} from './shared.js'
import { shellQuote } from './shared.js'
import { ensureContainerMcpConfigured, preflightChromeDevtoolsBrowser } from './browser.js'

const buildSessionContainerName = ({
  agent,
  sessionRoot
}: {
  agent: ContainerAgent
  sessionRoot: string
}): string => {
  const suffix = basename(sessionRoot).replace(/[^a-zA-Z0-9_.-]/g, '-')

  return `bugscrub-${agent}-${suffix}`
}

const buildDetachedSessionArgs = ({
  containerName,
  runArgs
}: {
  containerName: string
  runArgs: string[]
}): string[] => {
  return ['run', '-d', '--name', containerName, ...runArgs.slice(1)]
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

export const createDockerArgs = async ({
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
  const agentCliHomeDir = join(agentHomeDir, AGENT_HOME_RELATIVE_PATHS[agent][0]!)

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

const resolveExecutionTarget = async ({
  agent,
  containerArgs,
  containerName,
  sessionRoot,
  timeoutMs,
  workdir
}: ContainerExecutionTarget & {
  containerArgs: string[]
}): Promise<{
  args: string[]
  command: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}> => {
  if (containerName) {
    return {
      args: ['exec', '-w', workdir, containerName, ...containerArgs],
      command: 'docker',
      env: createSanitizedHostEnv(),
      timeoutMs
    }
  }

  if (!sessionRoot) {
    throw new CliError({
      message: 'A session root is required for one-shot container execution.',
      exitCode: 1
    })
  }

  const dockerArgs = await createDockerArgs({
    agent,
    containerArgs,
    sessionRoot,
    timeoutMs,
    workdir
  })

  return {
    args: dockerArgs.args,
    command: 'docker',
    env: dockerArgs.env,
    timeoutMs: dockerArgs.timeoutMs
  }
}

export const runContainerCommand = async ({
  agent,
  containerArgs,
  containerName,
  onStderr,
  onStdout,
  sessionRoot,
  timeoutMs,
  workdir
}: ContainerExecutionTarget & {
  containerArgs: string[]
  onStderr: ((chunk: string) => void) | undefined
  onStdout: ((chunk: string) => void) | undefined
}): Promise<{
  exitCode: number
  stderr: string
  stdout: string
}> => {
  const target = await resolveExecutionTarget({
    agent,
    containerArgs,
    containerName,
    sessionRoot,
    timeoutMs,
    workdir
  })

  return runCommand({
    args: target.args,
    command: target.command,
    env: target.env,
    ...(onStderr ? { onStderr } : {}),
    ...(onStdout ? { onStdout } : {}),
    timeoutMs: target.timeoutMs
  })
}

export const runShellInContainer = async ({
  agent,
  containerName,
  sessionRoot,
  script,
  timeoutMs,
  workdir
}: ContainerExecutionTarget & {
  script: string
}): Promise<{
  exitCode: number
  stderr: string
  stdout: string
}> => {
  return runContainerCommand({
    agent,
    containerArgs: ['sh', '-lc', script],
    containerName,
    onStderr: undefined,
    onStdout: undefined,
    sessionRoot,
    timeoutMs,
    workdir
  })
}

export const startContainerSession = async ({
  agent,
  sessionRoot,
  workdir
}: {
  agent: ContainerAgent
  sessionRoot: string
  workdir: string
}): Promise<string> => {
  const containerName = buildSessionContainerName({
    agent,
    sessionRoot
  })
  const dockerArgs = await createDockerArgs({
    agent,
    containerArgs: [...DEFAULT_SESSION_CONTAINER_COMMAND],
    sessionRoot,
    timeoutMs: 30_000,
    workdir
  })
  const result = await runCommand({
    args: buildDetachedSessionArgs({
      containerName,
      runArgs: dockerArgs.args
    }),
    command: 'docker',
    env: dockerArgs.env,
    timeoutMs: dockerArgs.timeoutMs
  })

  if (result.exitCode !== 0) {
    throw new CliError({
      message: [
        'Failed to start the BugScrub session container.',
        result.stderr.trim() || result.stdout.trim() || 'docker run failed.'
      ].join('\n'),
      exitCode: 1
    })
  }

  return containerName
}

export const stopContainerSession = async ({
  containerName
}: {
  containerName: string
}): Promise<void> => {
  await runCommand({
    args: ['rm', '-f', containerName],
    command: 'docker',
    env: createSanitizedHostEnv(),
    timeoutMs: 10_000
  })
}

export const runAgentInContainer = async ({
  agent,
  browserPreflightLogPath,
  containerName,
  cwd,
  onStderr,
  onStdout,
  prompt,
  requireBrowserPreflight = true,
  schemaPath,
  sessionRoot,
  timeoutMs
}: {
  agent: ContainerAgent
  browserPreflightLogPath?: string
  containerName?: string
  cwd: string
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  prompt: string
  requireBrowserPreflight?: boolean
  schemaPath?: string
  sessionRoot?: string
  timeoutMs: number
}): Promise<{
  exitCode: number
  stderr: string
  stdout: string
}> => {
  if (schemaPath && requireBrowserPreflight) {
    await ensureContainerMcpConfigured({
      agent,
      containerName,
      sessionRoot,
      timeoutMs,
      workdir: cwd
    })

    await preflightChromeDevtoolsBrowser({
      agent,
      containerName,
      logPath: browserPreflightLogPath ?? join(cwd, '.bugscrub', 'debug', 'chrome-devtools-preflight.log'),
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

  return runContainerCommand({
    agent,
    containerArgs,
    containerName,
    onStderr,
    onStdout,
    sessionRoot,
    timeoutMs,
    workdir: cwd
  })
}

export const readCodexLastMessage = async ({
  tempWorkspaceRoot
}: {
  tempWorkspaceRoot: string
}): Promise<string> => {
  return readFile(join(tempWorkspaceRoot, '.bugscrub', 'debug', 'codex-last-message.json'), 'utf8')
}

export const dockerInternals = {
  buildDetachedSessionArgs,
  createDockerArgs
}
