import { detectAvailableContainerAgents, readCodexLastMessage, runAgentInContainer } from '../../agent-runtime/container.js'
import { CliError } from '../../utils/errors.js'
import { logger } from '../../utils/logger.js'
import type { AdapterRunOutput, AgentAdapter, AgentCapabilities, RunContext } from './types.js'
import { parseRunResultOutput } from './result.js'

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
    const available = await detectAvailableContainerAgents()
    return available.includes('codex')
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return codexCapabilities
  }

  public async run(context: RunContext): Promise<AdapterRunOutput> {
    if (!context.containerSessionRoot) {
      throw new CliError({
        message: 'Codex runs now require a container session root.',
        exitCode: 1
      })
    }

    const command = await runAgentInContainer({
      agent: 'codex',
      cwd: context.cwd,
      onStdout: (chunk) => {
        emitCodexProgress({
          chunk
        })
      },
      prompt: context.prompt,
      schemaPath: context.artifacts.responseSchemaPath,
      sessionRoot: context.containerSessionRoot,
      timeoutMs: context.timeoutSeconds * 1_000
    })

    if (command.exitCode !== 0) {
      throw new CliError({
        message: [
          `Codex failed with exit code ${command.exitCode}.`,
          `Last-message artifact: ${context.artifacts.debugDir}/codex-last-message.json`,
          command.stderr.trim().length > 0 ? `stderr:\n${command.stderr.trim()}` : 'stderr: (empty)',
          command.stdout.trim().length > 0 ? `stdout:\n${command.stdout.trim()}` : 'stdout: (empty)'
        ].join('\n'),
        exitCode: 1
      })
    }

    let finalMessage: string

    try {
      finalMessage = await readCodexLastMessage({
        tempWorkspaceRoot: context.cwd
      })
    } catch (error) {
      throw new CliError({
        message: [
          `Codex completed without writing the expected last-message artifact at ${context.artifacts.debugDir}/codex-last-message.json.`,
          error instanceof Error ? error.message : String(error),
          command.stderr.trim().length > 0 ? `stderr:\n${command.stderr.trim()}` : 'stderr: (empty)',
          command.stdout.trim().length > 0 ? `stdout:\n${command.stdout.trim()}` : 'stdout: (empty)'
        ].join('\n'),
        exitCode: 1
      })
    }

    const { result } = parseRunResultOutput({
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
