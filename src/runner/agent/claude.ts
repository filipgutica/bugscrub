import { detectAvailableContainerAgents, runAgentInContainer } from '../../agent-runtime/container.js'
import { CliError } from '../../utils/errors.js'
import type { AdapterRunOutput, AgentAdapter, AgentCapabilities, RunContext } from './types.js'
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

  public async detect(): Promise<boolean> {
    const available = await detectAvailableContainerAgents()
    return available.includes('claude')
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return claudeCapabilities
  }

  public async run(context: RunContext): Promise<AdapterRunOutput> {
    if (!context.containerSessionRoot) {
      throw new CliError({
        message: 'Claude runs now require a container session root.',
        exitCode: 1
      })
    }

    const command = await runAgentInContainer({
      agent: 'claude',
      cwd: context.cwd,
      prompt: context.prompt,
      schemaPath: context.artifacts.responseSchemaPath,
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
      result
    }
  }
}
