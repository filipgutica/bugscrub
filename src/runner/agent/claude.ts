import { join } from 'node:path'
import { detectAvailableContainerAgents, runAgentInContainer } from '../../agent-runtime/container.js'
import { CliError } from '../../utils/errors.js'
import { buildOutputRepairPrompt } from './repair.js'
import type { AdapterRunOutput, AgentAdapter, AgentCapabilities, RepairOutputInput, RunContext } from './types.js'
import { parseRunResultOutput } from './result.js'

const claudeCapabilities: AgentCapabilities = {
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

export class ClaudeAdapter implements AgentAdapter {
  public readonly name = 'claude' as const
  public readonly requiresContainer = true

  public async detect(): Promise<boolean> {
    const available = await detectAvailableContainerAgents()
    return available.includes('claude')
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return claudeCapabilities
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
        message: 'Claude runs now require a container session root.',
        exitCode: 1
      })
    }

    const command = await runAgentInContainer({
      agent: 'claude',
      browserPreflightLogPath: join(context.artifacts.debugDir, 'chrome-devtools-preflight.log'),
      cwd: context.cwd,
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

    if (command.exitCode !== 0) {
      throw new CliError({
        message: `Claude Code failed with exit code ${command.exitCode}.\n${command.stderr.trim()}`,
        exitCode: 1
      })
    }

    const trimmed = command.stdout.trim()
    const { result } = parseRunResultOutput({
      agent: 'claude',
      output: trimmed
    })

    return {
      artifacts: {
        stderr: command.stderr,
        stdout: command.stdout
      },
      rawResponse: trimmed,
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
