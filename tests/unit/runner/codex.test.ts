import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/runner/agent/process.js', () => ({
  isCommandAvailable: vi.fn(),
  runCommand: vi.fn()
}))

import { CodexAdapter } from '../../../src/runner/agent/codex.js'
import { runCommand } from '../../../src/runner/agent/process.js'
import type { RunContext } from '../../../src/runner/agent/types.js'

const mockRunCommand = vi.mocked(runCommand)
const tempDirectories: string[] = []

const createRunContext = ({
  root
}: {
  root: string
}): RunContext => {
  return {
    agent: {
      capabilities: {
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
      },
      name: 'codex'
    },
    artifacts: {
      debugDir: join(root, 'debug'),
      networkDir: join(root, 'network'),
      promptPath: join(root, 'prompt.md'),
      reportJsonPath: join(root, 'report.json'),
      reportMarkdownPath: join(root, 'report.md'),
      responseSchemaPath: join(root, 'schema.json'),
      screenshotsDir: join(root, 'screenshots'),
      transcriptPath: join(root, 'agent-transcript.jsonl')
    },
    config: {
      version: '0',
      project: 'bugscrub',
      defaultEnv: 'local',
      envs: {
        local: {
          baseUrl: 'http://localhost:3000',
          defaultIdentity: 'user',
          identities: {
            user: {
              auth: {
                type: 'token-env',
                tokenEnvVar: 'BUGSCRUB_TOKEN'
              }
            }
          }
        }
      },
      agent: {
        preferred: 'codex',
        timeout: 300,
        maxBudgetUsd: 5
      }
    },
    cwd: root,
    environment: {
      baseUrl: 'http://localhost:3000',
      defaultIdentity: {
        auth: {
          type: 'token-env',
          tokenEnvVar: 'BUGSCRUB_TOKEN'
        },
        name: 'user'
      },
      identities: [
        {
          auth: {
            type: 'token-env',
            tokenEnvVar: 'BUGSCRUB_TOKEN'
          },
          name: 'user'
        }
      ],
      name: 'local'
    },
    hardAssertions: [],
    maxBudgetUsd: 5,
    maxSteps: 10,
    prompt: 'prompt',
    runId: 'run-id',
    selectedSurface: {
      assertionMap: new Map(),
      capabilityMap: new Map(),
      directoryName: 'surface',
      directoryPath: join(root, 'surface'),
      signalMap: new Map(),
      surface: {
        name: 'surface',
        routes: ['/'],
        elements: {},
        capabilities: []
      }
    },
    setup: [],
    tasks: [],
    timeoutSeconds: 30,
    workflow: {
      name: 'workflow',
      target: {
        surface: 'surface',
        env: 'local'
      },
      requires: [],
      setup: [],
      exploration: {
        tasks: []
      },
      hard_assertions: [],
      evidence: {
        screenshots: false,
        network_logs: false
      }
    },
    workflowPath: '.bugscrub/workflows/workflow.yaml'
  }
}

describe('CodexAdapter', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    mockRunCommand.mockReset()
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('runs Codex in read-only sandbox mode without dangerous-permissions config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bugscrub-codex-test-'))
    tempDirectories.push(root)
    await writeFile(join(root, 'schema.json'), '{}\n', 'utf8')

    mockRunCommand.mockImplementation(async ({ args }) => {
      const outputIndex = args.indexOf('--output-last-message')
      const outputPath = args[outputIndex + 1]!

      await writeFile(
        outputPath,
        JSON.stringify({
          status: 'passed',
          startedAt: '2026-03-10T17:00:00.000Z',
          completedAt: '2026-03-10T17:00:02.000Z',
          durationMs: 2000,
          findings: [],
          assertionResults: [],
          evidence: {
            screenshots: [],
            networkLogs: []
          },
          raw: {
            adapter: 'codex'
          }
        }),
        'utf8'
      )

      return {
        exitCode: 0,
        stderr: '',
        stdout: '{"event":"completed"}\n'
      }
    })

    const adapter = new CodexAdapter()
    const result = await adapter.run(
      createRunContext({
        root
      })
    )

    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'exec',
          '--model',
          'gpt-5.3-codex',
          '--json',
          '--sandbox',
          'read-only'
        ])
      })
    )
    expect(result.result.status).toBe('passed')
    await expect(readFile(join(root, 'agent-transcript.jsonl'), 'utf8')).rejects.toBeDefined()
  })
})
