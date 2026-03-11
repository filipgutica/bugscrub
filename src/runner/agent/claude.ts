import { getJsonSchemaByType } from '../../schemas/index.js'
import { CliError } from '../../utils/errors.js'
import { runCommand, isCommandAvailable } from './process.js'
import type { AdapterRunOutput, AgentAdapter, AgentCapabilities, RunContext } from './types.js'
import { parseRunResultOutput } from './result.js'

// Default to Sonnet for BugScrub because these runs need reliable tool use and
// instruction-following, but usually not Opus-level reasoning cost.
const DEFAULT_CLAUDE_MODEL = 'sonnet'

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
    const schema = JSON.stringify(getJsonSchemaByType({ type: 'run-result' }))
    const command = await runCommand({
      command: 'claude',
      cwd: context.cwd,
      timeoutMs: context.timeoutSeconds * 1_000,
      args: [
        '--print',
        '--output-format',
        'json',
        '--model',
        DEFAULT_CLAUDE_MODEL,
        '--json-schema',
        schema,
        '--permission-mode',
        'acceptEdits',
        '--disallowedTools',
        'Edit,MultiEdit,NotebookEdit,Write',
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
