import { dirname } from 'node:path'

import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { runShellInContainer } from './docker.js'
import { type ContainerExecutionTarget, LOCAL_RUNTIME_ENV_PREFIX, shellQuote } from './shared.js'

export const isUrlReachableInContainer = async ({
  agent,
  containerName,
  sessionRoot,
  timeoutMs = 5_000,
  url,
  workdir
}: ContainerExecutionTarget & {
  timeoutMs?: number
  url: string
}): Promise<boolean> => {
  const result = await runShellInContainer({
    agent,
    containerName,
    sessionRoot,
    script: [
      'node --input-type=module -e',
      shellQuote(
        `const url = process.argv[1];
await fetch(url);
process.exit(0);`
      ),
      shellQuote(url)
    ].join(' '),
    timeoutMs,
    workdir
  })

  return result.exitCode === 0
}

export const prepareLocalRuntimeInContainer = async ({
  agent,
  baseUrl,
  containerName,
  installCommand,
  readyPath,
  readyTimeoutMs,
  serverLogPath,
  sessionRoot,
  startCommand,
  workdir
}: ContainerExecutionTarget & {
  baseUrl: string
  installCommand: string | undefined
  readyPath: string
  readyTimeoutMs: number
  serverLogPath: string
  startCommand: string
}): Promise<void> => {
  const probeUrl = new URL(readyPath, baseUrl).toString()
  const pidPath = `${serverLogPath}.pid`
  const logDir = dirname(serverLogPath)
  let lastWaitLogAt = 0

  const ensureLogDirectory = async (): Promise<void> => {
    const result = await runShellInContainer({
      agent,
      containerName,
      sessionRoot,
      script: `${LOCAL_RUNTIME_ENV_PREFIX} mkdir -p ${shellQuote(logDir)} && touch ${shellQuote(serverLogPath)}`,
      timeoutMs: 10_000,
      workdir
    })

    if (result.exitCode !== 0) {
      throw new CliError({
        message: [
          `Failed to prepare the local runtime log path at ${serverLogPath}.`,
          result.stderr.trim().length > 0 ? `stderr:\n${result.stderr.trim()}` : 'stderr: (empty)',
          result.stdout.trim().length > 0 ? `stdout:\n${result.stdout.trim()}` : 'stdout: (empty)'
        ].join('\n'),
        exitCode: 1
      })
    }
  }

  if (
    await isUrlReachableInContainer({
      agent,
      containerName,
      sessionRoot,
      timeoutMs: 5_000,
      url: probeUrl,
      workdir
    })
  ) {
    logger.info(`Local runtime is already reachable at ${probeUrl}.`)
    return
  }

  await ensureLogDirectory()

  if (installCommand) {
    logger.info(`Installing app dependencies in-container: ${installCommand}`)
    const installResult = await runShellInContainer({
      agent,
      containerName,
      sessionRoot,
      script: `${LOCAL_RUNTIME_ENV_PREFIX} ${installCommand} >> ${shellQuote(serverLogPath)} 2>&1`,
      timeoutMs: readyTimeoutMs,
      workdir
    })

    if (installResult.exitCode !== 0) {
      throw new CliError({
        message: [
          `Configured local runtime install command failed before startup: ${installCommand}`,
          `Startup log: ${serverLogPath}`,
          installResult.stderr.trim().length > 0
            ? `stderr:\n${installResult.stderr.trim()}`
            : 'stderr: (empty)',
          installResult.stdout.trim().length > 0
            ? `stdout:\n${installResult.stdout.trim()}`
            : 'stdout: (empty)'
        ].join('\n'),
        exitCode: 1
      })
    }
  }

  logger.info(`Starting app in-container: ${startCommand}`)
  const startResult = await runShellInContainer({
    agent,
    containerName,
    sessionRoot,
    script: [
      `nohup sh -lc ${shellQuote(`${LOCAL_RUNTIME_ENV_PREFIX} ${startCommand}`)} >> ${shellQuote(serverLogPath)} 2>&1 < /dev/null & echo $! > ${shellQuote(pidPath)}`
    ].join(' && '),
    timeoutMs: 10_000,
    workdir
  })

  if (startResult.exitCode !== 0) {
    throw new CliError({
      message: [
        `Configured local runtime start command failed to launch: ${startCommand}`,
        `Startup log: ${serverLogPath}`,
        startResult.stderr.trim().length > 0
          ? `stderr:\n${startResult.stderr.trim()}`
          : 'stderr: (empty)',
        startResult.stdout.trim().length > 0
          ? `stdout:\n${startResult.stdout.trim()}`
          : 'stdout: (empty)'
      ].join('\n'),
      exitCode: 1
    })
  }

  const deadline = Date.now() + readyTimeoutMs

  while (Date.now() < deadline) {
    if (
      await isUrlReachableInContainer({
        agent,
        containerName,
        sessionRoot,
        timeoutMs: 5_000,
        url: probeUrl,
        workdir
      })
    ) {
      logger.success(`Local runtime is ready at ${probeUrl}.`)
      return
    }

    if (Date.now() - lastWaitLogAt >= 10_000) {
      logger.info(`Waiting for local runtime readiness at ${probeUrl}...`)
      lastWaitLogAt = Date.now()
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1_000)
    })
  }

  throw new CliError({
    message: [
      `Configured local runtime did not become ready at ${probeUrl} within ${readyTimeoutMs}ms.`,
      `Startup log: ${serverLogPath}`
    ].join('\n'),
    exitCode: 1
  })
}
