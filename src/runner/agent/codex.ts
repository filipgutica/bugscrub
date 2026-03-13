import { detectAvailableContainerAgents, readCodexLastMessage, runAgentInContainer } from '../../agent-runtime/container.js'
import { join } from 'node:path'
import { CliError } from '../../utils/errors.js'
import { logger } from '../../utils/logger.js'
import { buildOutputRepairPrompt } from './repair.js'
import type { AdapterRunOutput, AgentAdapter, AgentCapabilities, RepairOutputInput, RunContext } from './types.js'
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

const createCodexProgressEmitter = (): (({
  chunk
}: {
  chunk: string
}) => void) => {
  let pendingBrowserStepCount = 0
  let lastBrowserToolName: string | undefined

  const flushBrowserSummary = (): void => {
    if (pendingBrowserStepCount === 0) {
      return
    }

    logger.info(
      pendingBrowserStepCount === 1
        ? `Browser step: ${lastBrowserToolName ?? 'interaction'}`
        : `Browser steps: ${pendingBrowserStepCount} interactions (last: ${lastBrowserToolName ?? 'interaction'})`
    )
    pendingBrowserStepCount = 0
    lastBrowserToolName = undefined
  }

  return ({
    chunk
  }: {
    chunk: string
  }): void => {
    for (const line of chunk.split('\n').map((segment) => segment.trim()).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        aggregated_output?: string
        error?: { message?: string }
        item?: {
          command?: string
          id?: string
          raw_input?: string[]
          server?: string
          status?: string
          text?: string
          tool?: string
          tool_name?: string
          type?: string
        }
        message?: string
        thread_id?: string
        type?: string
      }

      if (event.type === 'thread.started') {
        flushBrowserSummary()
        logger.info(`Codex run started${event.thread_id ? ` (thread ${event.thread_id}).` : '.'}`)
        continue
      }

      if (event.type === 'turn.started') {
        flushBrowserSummary()
        logger.info('Codex is executing the workflow.')
        continue
      }

      if (event.type === 'turn.completed') {
        flushBrowserSummary()
        logger.success('Codex finished execution and is returning the final result.')
        continue
      }

      if (event.type === 'turn.failed') {
        flushBrowserSummary()
        logger.error('Codex reported a failed turn.')
        continue
      }

      if (event.type === 'error') {
        flushBrowserSummary()
        logger.error(event.message ?? event.error?.message ?? 'Codex reported an error.')
        continue
      }

      if (event.type === 'item.started' && event.item?.type === 'command_execution') {
        flushBrowserSummary()
        logger.info(`Codex command: ${event.item.command ?? 'shell command started'}`)
        continue
      }

      if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
        flushBrowserSummary()
        const status = event.item.status ?? 'completed'
        if (status === 'failed') {
          logger.warn(`Codex command failed: ${event.item.command ?? 'shell command'}`)
        } else {
          logger.info(`Codex command completed: ${event.item.command ?? 'shell command'}`)
        }
        continue
      }

      if (event.type === 'item.started' && event.item?.type === 'mcp_tool_call') {
        const toolName = event.item.tool ?? event.item.tool_name ?? 'tool'
        const isBrowserTool =
          event.item.server === 'chrome-devtools' ||
          toolName.includes('chrome-devtools')

        if (isBrowserTool) {
          pendingBrowserStepCount += 1
          lastBrowserToolName = toolName.replace(/^mcp__chrome-devtools__/, '')

          if (pendingBrowserStepCount >= 8) {
            flushBrowserSummary()
          }
        } else {
          flushBrowserSummary()
          logger.info(`Tool step: ${toolName}`)
        }
        continue
      }

      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        flushBrowserSummary()
        const text = event.item.text?.trim()
        if (text && !text.startsWith('{')) {
          logger.info(text)
        }
      }
    } catch {
      // Ignore non-JSON chunks. We still preserve full stdout in artifacts.
    }
  }
  }
}

export class CodexAdapter implements AgentAdapter {
  public readonly name = 'codex' as const
  public readonly requiresContainer = true

  public async detect(): Promise<boolean> {
    const available = await detectAvailableContainerAgents()
    return available.includes('codex')
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return codexCapabilities
  }

  private async execute({
    context,
    prompt,
    requireBrowserPreflight
  }: {
    context: RunContext
    prompt: string
    requireBrowserPreflight: boolean
  }): Promise<AdapterRunOutput> {
    if (!context.containerSessionRoot) {
      throw new CliError({
        message: 'Codex runs now require a container session root.',
        exitCode: 1
      })
    }

    const emitCodexProgress = createCodexProgressEmitter()
    const command = await runAgentInContainer({
      agent: 'codex',
      browserPreflightLogPath: join(context.artifacts.debugDir, 'chrome-devtools-preflight.log'),
      cwd: context.cwd,
      onStdout: (chunk) => {
        emitCodexProgress({
          chunk
        })
      },
      prompt,
      requireBrowserPreflight,
      schemaPath: context.artifacts.responseSchemaPath,
      ...(context.containerSessionName
        ? {
            containerName: context.containerSessionName
          }
        : {}),
      sessionRoot: context.containerSessionRoot,
      timeoutMs: context.timeoutSeconds * 1_000
    })

    let finalMessage: string

    try {
      finalMessage = await readCodexLastMessage({
        tempWorkspaceRoot: context.cwd
      })
    } catch (error) {
      if (command.exitCode === 0) {
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

      throw new CliError({
        message: [
          `Codex failed with exit code ${command.exitCode}.`,
          `Last-message artifact: ${context.artifacts.debugDir}/codex-last-message.json`,
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

    if (command.exitCode !== 0) {
      logger.warn(
        `Codex exited with code ${command.exitCode}, but BugScrub recovered the structured run result from ${context.artifacts.debugDir}/codex-last-message.json.`
      )
    }

    return {
      artifacts: {
        stderr: command.stderr,
        stdout: command.stdout
      },
      rawResponse: finalMessage,
      result
    }
  }

  public async run(context: RunContext): Promise<AdapterRunOutput> {
    return this.execute({
      context,
      prompt: context.prompt,
      requireBrowserPreflight: true
    })
  }

  public async repairOutput(
    context: RunContext,
    input: RepairOutputInput
  ): Promise<AdapterRunOutput> {
    return this.execute({
      context,
      prompt: buildOutputRepairPrompt({
        agent: this.name,
        context,
        input
      }),
      requireBrowserPreflight: false
    })
  }
}
