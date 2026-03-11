import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CliError } from '../../utils/errors.js'
import { logger } from '../../utils/logger.js'
import { runCommand, isCommandAvailable } from './process.js'
import type { AdapterRunOutput, AgentAdapter, AgentCapabilities, RunContext } from './types.js'
import { parseRunResultOutput } from './result.js'

// Default to the Codex-optimized frontier model rather than the global CLI default.
// This keeps BugScrub on a strong coding model without paying the highest-tier general-model cost.
const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex'

const codexCapabilities: AgentCapabilities = {
  browser: {
    navigation: true,
    domRead: true,
    networkObserve: true,
    screenshots: true
  },
  api: {
    httpRequests: true
  },
  auth: {
    session: true,
    token: true
  }
}

const createCodexRunEnv = ({
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

const emitCodexProgress = ({
  chunk
}: {
  chunk: string
}): void => {
  for (const line of chunk.split('\n').map((segment) => segment.trim()).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        error?: { message?: string }
        message?: string
        thread_id?: string
        type?: string
      }

      if (event.type === 'thread.started') {
        logger.info(`Codex run started${event.thread_id ? ` (thread ${event.thread_id}).` : '.'}`)
        continue
      }

      if (event.type === 'turn.started') {
        logger.info('Codex is executing the workflow.')
        continue
      }

      if (event.type === 'turn.completed') {
        logger.success('Codex finished execution and is returning the final result.')
        continue
      }

      if (event.type === 'turn.failed') {
        logger.error('Codex reported a failed turn.')
        continue
      }

      if (event.type === 'error') {
        logger.error(event.message ?? event.error?.message ?? 'Codex reported an error.')
      }
    } catch {
      // Ignore non-JSON chunks. We still preserve full stdout in artifacts.
    }
  }
}

export class CodexAdapter implements AgentAdapter {
  public readonly name = 'codex' as const

  public async detect(): Promise<boolean> {
    return isCommandAvailable({
      command: 'codex'
    })
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return codexCapabilities
  }

  public async run(context: RunContext): Promise<AdapterRunOutput> {
    const outputMessagePath = join(context.artifacts.debugDir, 'codex-last-message.json')
    const command = await runCommand({
      command: 'codex',
      cwd: context.cwd,
      env: createCodexRunEnv(),
      timeoutMs: context.timeoutSeconds * 1_000,
      args: [
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '--json',
        '--sandbox',
        'read-only',
        '--output-schema',
        context.artifacts.responseSchemaPath,
        '--output-last-message',
        outputMessagePath,
        context.prompt
      ],
      onStdout: (chunk) => {
        emitCodexProgress({
          chunk
        })
      }
    })

    if (command.exitCode !== 0) {
      throw new CliError({
        message: [
          `Codex failed with exit code ${command.exitCode}.`,
          `Last-message artifact: ${outputMessagePath}`,
          command.stderr.trim().length > 0 ? `stderr:\n${command.stderr.trim()}` : 'stderr: (empty)',
          command.stdout.trim().length > 0 ? `stdout:\n${command.stdout.trim()}` : 'stdout: (empty)'
        ].join('\n'),
        exitCode: 1
      })
    }

    let finalMessage: string

    try {
      finalMessage = await readFile(outputMessagePath, 'utf8')
    } catch (error) {
      throw new CliError({
        message: [
          `Codex completed without writing the expected last-message artifact at ${outputMessagePath}.`,
          error instanceof Error ? error.message : String(error),
          command.stderr.trim().length > 0 ? `stderr:\n${command.stderr.trim()}` : 'stderr: (empty)',
          command.stdout.trim().length > 0 ? `stdout:\n${command.stdout.trim()}` : 'stdout: (empty)'
        ].join('\n'),
        exitCode: 1
      })
    }

    const { parsed, result } = parseRunResultOutput({
      agent: 'codex',
      output: finalMessage
    })

    return {
      artifacts: {
        stderr: command.stderr,
        stdout: command.stdout
      },
      result
    }
  }
}
