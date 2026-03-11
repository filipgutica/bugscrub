import { spawn } from 'node:child_process'

const timedOutExitCode = -1

export const isCommandAvailable = async ({
  command
}: {
  command: string
}): Promise<boolean> => {
  const result = await runCommand({
    args: ['-lc', `command -v ${command}`],
    command: process.env.SHELL ?? '/bin/sh',
    timeoutMs: 5_000
  })

  return result.exitCode === 0
}

export const runCommand = async ({
  args,
  command,
  cwd,
  env,
  onStderr,
  onStdout,
  timeoutMs
}: {
  args: string[]
  command: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  timeoutMs: number
}): Promise<{
  exitCode: number
  stderr: string
  stdout: string
}> => {
  const child = spawn(command, args, {
    cwd,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  let didTimeout = false

  child.stdout.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString()
    stdout += text
    onStdout?.(text)
  })
  child.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString()
    stderr += text
    onStderr?.(text)
  })

  const timeout = setTimeout(() => {
    didTimeout = true
    child.kill('SIGTERM')
  }, timeoutMs)

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      resolve(didTimeout ? timedOutExitCode : (code ?? 1))
    })
  }).finally(() => {
    clearTimeout(timeout)
  })

  return {
    exitCode,
    stderr,
    stdout
  }
}
