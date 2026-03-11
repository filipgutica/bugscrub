import { readFile } from 'node:fs/promises'

import { CliError } from '../../utils/errors.js'
import { runCommand, isCommandAvailable } from './process.js'
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
    const command = await runCommand({
      command: 'codex',
      cwd: context.cwd,
      timeoutMs: context.timeoutSeconds * 1_000,
      args: [
        'exec',
        '--full-auto',
        '--json',
        '--skip-git-repo-check',
        '--output-schema',
        context.artifacts.responseSchemaPath,
        '--output-last-message',
        context.artifacts.transcriptPath,
        context.prompt
      ]
    })

    if (command.exitCode !== 0) {
      throw new CliError({
        message: `Codex failed with exit code ${command.exitCode}.\n${command.stderr.trim()}`,
        exitCode: 1
      })
    }

    const finalMessage = await readFile(context.artifacts.transcriptPath, 'utf8')
    const { parsed, result } = parseRunResultOutput({
      agent: 'codex',
      output: finalMessage
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
