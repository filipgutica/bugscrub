import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CliError } from '../../utils/errors.js'
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
    const outputRoot = await mkdtemp(join(tmpdir(), 'bugscrub-codex-run-'))
    const outputMessagePath = join(outputRoot, 'last-message.json')

    try {
      const command = await runCommand({
        command: 'codex',
        cwd: context.cwd,
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
        ]
      })

      if (command.exitCode !== 0) {
        throw new CliError({
          message: `Codex failed with exit code ${command.exitCode}.\n${command.stderr.trim()}`,
          exitCode: 1
        })
      }

      const finalMessage = await readFile(outputMessagePath, 'utf8')
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
    } finally {
      await rm(outputRoot, {
        force: true,
        recursive: true
      })
    }
  }
}
