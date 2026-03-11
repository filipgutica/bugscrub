import { getJsonSchemaByType } from '../../schemas/index.js'
import { CliError } from '../../utils/errors.js'
import { runCommand, isCommandAvailable } from './process.js'
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
    return isCommandAvailable({
      command: 'claude'
    })
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return claudeCapabilities
  }

  public async run(context: RunContext): Promise<AdapterRunOutput> {
    if (!context.config.agent.allowDangerousPermissions) {
      throw new CliError({
        message:
          'Claude Code runs require `agent.allowDangerousPermissions: true` in `.bugscrub/bugscrub.config.yaml`.',
        exitCode: 1
      })
    }

    const schema = JSON.stringify(getJsonSchemaByType({ type: 'run-result' }))
    const command = await runCommand({
      command: 'claude',
      cwd: context.cwd,
      timeoutMs: context.timeoutSeconds * 1_000,
      args: [
        '--print',
        '--output-format',
        'json',
        '--json-schema',
        schema,
        '--dangerously-skip-permissions',
        '--max-budget-usd',
        String(context.maxBudgetUsd),
        context.prompt
      ]
    })

    if (command.exitCode !== 0) {
      throw new CliError({
        message: `Claude Code failed with exit code ${command.exitCode}.\n${command.stderr.trim()}`,
        exitCode: 1
      })
    }

    const trimmed = command.stdout.trim()
    const { parsed, result } = parseRunResultOutput({
      agent: 'claude',
      output: trimmed
    })

    return {
      artifacts: {
        raw: {
          response: parsed
        },
        stderr: command.stderr,
        stdout: command.stdout
      },
      result
    }
  }
}
