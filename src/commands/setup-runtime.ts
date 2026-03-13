import { Command } from 'commander'
import { resolve } from 'node:path'

import { isCommandAvailable, runCommand } from '../runner/agent/process.js'
import { CliError } from '../utils/errors.js'
import { fileExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import { resolveInstalledPackageRoot } from '../utils/package-root.js'

const DEFAULT_CONTAINER_IMAGE = 'bugscrub-agent:latest'

const createSanitizedEnv = ({
  baseEnv = process.env
}: {
  baseEnv?: NodeJS.ProcessEnv
} = {}): NodeJS.ProcessEnv => {
  const env = {
    ...baseEnv
  }

  delete env.NODE_INSPECT_RESUME_ON_START
  delete env.NODE_OPTIONS
  delete env.VSCODE_INSPECTOR_OPTIONS

  return env
}

const resolveContainerImage = ({
  env = process.env
}: {
  env?: NodeJS.ProcessEnv
} = {}): string => {
  return env.BUGSCRUB_CONTAINER_IMAGE ?? DEFAULT_CONTAINER_IMAGE
}

const resolveDockerfilePath = ({
  packageRoot
}: {
  packageRoot: string
}): string => {
  return resolve(packageRoot, 'docker', 'bugscrub-agent.Dockerfile')
}

const ensureDockerBuildx = async ({
  env
}: {
  env: NodeJS.ProcessEnv
}): Promise<void> => {
  const buildx = await runCommand({
    args: ['buildx', 'version'],
    command: 'docker',
    env,
    timeoutMs: 10_000
  })

  if (buildx.exitCode !== 0) {
    throw new CliError({
      message: [
        'Docker Buildx is required to build the BugScrub runtime image.',
        buildx.stderr.trim() || buildx.stdout.trim() || 'docker buildx is unavailable.',
        'Install or repair the Docker Buildx plugin before running `bugscrub setup-runtime`.'
      ].join('\n'),
      exitCode: 1
    })
  }
}

export const runSetupRuntimeCommand = async ({
  force = false,
  packageRoot,
  env = process.env
}: {
  env?: NodeJS.ProcessEnv
  force?: boolean
  packageRoot?: string
} = {}): Promise<void> => {
  const resolvedPackageRoot =
    packageRoot ??
    await resolveInstalledPackageRoot({
      metaUrl: import.meta.url
    })
  const dockerfilePath = resolveDockerfilePath({
    packageRoot: resolvedPackageRoot
  })
  const containerImage = resolveContainerImage({
    env
  })
  const sanitizedEnv = createSanitizedEnv({
    baseEnv: env
  })

  if (
    !(await fileExists({
      path: dockerfilePath
    }))
  ) {
    throw new CliError({
      message: [
        `BugScrub runtime Dockerfile not found at ${dockerfilePath}.`,
        'Reinstall bugscrub or run this command from a package installation that includes the runtime image definition.'
      ].join('\n'),
      exitCode: 1
    })
  }

  const dockerInstalled = await isCommandAvailable({
    command: 'docker'
  })

  logger.info(`Preparing BugScrub runtime image "${containerImage}".`)

  if (!dockerInstalled) {
    throw new CliError({
      message: [
        'Docker is required for BugScrub agent execution.',
        'Install Docker and ensure the daemon is running before running `bugscrub setup-runtime`.'
      ].join('\n'),
      exitCode: 1
    })
  }

  const dockerInfo = await runCommand({
    args: ['info', '--format', '{{json .ServerVersion}}'],
    command: 'docker',
    env: sanitizedEnv,
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

  if (!force) {
    logger.info(`Checking whether "${containerImage}" already exists locally.`)
    const inspect = await runCommand({
      args: ['image', 'inspect', containerImage],
      command: 'docker',
      env: sanitizedEnv,
      timeoutMs: 10_000
    })

    if (inspect.exitCode === 0) {
      logger.success(
        `BugScrub runtime image "${containerImage}" is already available locally.`
      )
      return
    }
  }

  logger.info('Checking Docker Buildx availability.')
  await ensureDockerBuildx({
    env: sanitizedEnv
  })

  logger.info(
    `Building runtime image "${containerImage}" from ${dockerfilePath}. This can take a minute.`
  )
  const build = await runCommand({
    args: [
      'buildx',
      'build',
      '--load',
      '--file',
      dockerfilePath,
      '--tag',
      containerImage,
      resolve(resolvedPackageRoot)
    ],
    command: 'docker',
    env: sanitizedEnv,
    timeoutMs: 20 * 60 * 1_000
  })

  if (build.exitCode !== 0) {
    throw new CliError({
      message: [
        `Failed to build BugScrub runtime image "${containerImage}".`,
        build.stderr.trim() || build.stdout.trim() || 'docker build failed.'
      ].join('\n'),
      exitCode: 1
    })
  }

  logger.success(
    [
      `BugScrub runtime image "${containerImage}" is ready.`,
      'You can now run `bugscrub init`, `bugscrub discover`, and live `bugscrub run` commands.'
    ].join('\n')
  )
}

export const registerSetupRuntimeCommand = (program: Command): void => {
  program
    .command('setup-runtime')
    .description('Build the local Docker runtime image used by BugScrub agent-backed commands.')
    .option('--force', 'Rebuild the image even if it already exists locally.')
    .action(async ({ force }: { force?: boolean }) => {
      await runSetupRuntimeCommand({
        force: force ?? false
      })
    })
}

export const setupRuntimeCommandInternals = {
  createSanitizedEnv,
  DEFAULT_CONTAINER_IMAGE,
  ensureDockerBuildx,
  resolveContainerImage,
  resolveDockerfilePath
}
