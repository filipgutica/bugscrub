import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/agent-runtime/container.js', () => ({
  detectAvailableContainerAgents: vi.fn(),
  readCodexLastMessage: vi.fn(),
  runAgentInContainer: vi.fn()
}))

import { CodexAdapter } from '../../../src/runner/agent/codex.js'
import {
  readCodexLastMessage,
  runAgentInContainer
} from '../../../src/agent-runtime/container.js'
import { CliError } from '../../../src/utils/errors.js'
import { logger } from '../../../src/utils/logger.js'
import type { RunContext } from '../../../src/runner/agent/types.js'

const mockReadCodexLastMessage = vi.mocked(readCodexLastMessage)
const mockRunAgentInContainer = vi.mocked(runAgentInContainer)
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
    containerSessionRoot: join(root, 'session'),
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
    mockReadCodexLastMessage.mockReset()
    mockRunAgentInContainer.mockReset()
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('runs Codex in read-only sandbox mode without dangerous-permissions config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bugscrub-codex-test-'))
    tempDirectories.push(root)
    await mkdir(join(root, 'debug'), { recursive: true })
    await writeFile(join(root, 'schema.json'), '{}\n', 'utf8')

    mockRunAgentInContainer.mockImplementation(async ({ onStdout }) => {
      onStdout?.([
        '{"type":"thread.started","thread_id":"thread-123"}',
        '{"type":"turn.started"}',
        '{"type":"turn.completed"}'
      ].join('\n'))

      return {
        exitCode: 0,
        stderr: '',
        stdout: [
          '{"type":"thread.started","thread_id":"thread-123"}',
          '{"type":"turn.started"}',
          '{"type":"turn.completed"}'
        ].join('\n')
      }
    })
    mockReadCodexLastMessage.mockResolvedValue(
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
        }
      })
    )

    const loggerInfoSpy = vi.spyOn(logger, 'info')
    const loggerSuccessSpy = vi.spyOn(logger, 'success')

    const adapter = new CodexAdapter()
    const result = await adapter.run(
      createRunContext({
        root
      })
    )

    expect(mockRunAgentInContainer).toHaveBeenCalledWith({
      agent: 'codex',
      browserPreflightLogPath: join(root, 'debug', 'chrome-devtools-preflight.log'),
      cwd: root,
      onStdout: expect.any(Function),
      prompt: 'prompt',
      requireBrowserPreflight: true,
      schemaPath: join(root, 'schema.json'),
      sessionRoot: join(root, 'session'),
      timeoutMs: 30_000
    })
    expect(loggerInfoSpy).toHaveBeenCalledWith('Codex run started (thread thread-123).')
    expect(loggerInfoSpy).toHaveBeenCalledWith('Codex is executing the workflow.')
    expect(loggerSuccessSpy).toHaveBeenCalledWith(
      'Codex finished execution and is returning the final result.'
    )
    expect(result.result.status).toBe('passed')
  })

  it('surfaces codex stdout and stderr and preserves the last-message artifact path on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bugscrub-codex-test-'))
    tempDirectories.push(root)
    await mkdir(join(root, 'debug'), { recursive: true })
    await writeFile(join(root, 'schema.json'), '{}\n', 'utf8')

    mockRunAgentInContainer.mockResolvedValue({
      exitCode: 1,
      stderr: 'fatal: codex backend error\n',
      stdout: '{"event":"failed"}\n'
    })
    mockReadCodexLastMessage.mockRejectedValue(new Error('ENOENT: no such file or directory'))

    const adapter = new CodexAdapter()

    await expect(
      adapter.run(
        createRunContext({
          root
        })
      )
    ).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('fatal: codex backend error')
    })

    try {
      await adapter.run(
        createRunContext({
          root
        })
      )
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect((error as CliError).message).toContain('stdout:')
      expect((error as CliError).message).toContain('stderr:')
      expect((error as CliError).message).toContain(
        join(root, 'debug', 'codex-last-message.json')
      )
    }
  })

  it('recovers the report from codex-last-message.json when Codex exits non-zero after writing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bugscrub-codex-test-'))
    tempDirectories.push(root)
    await mkdir(join(root, 'debug'), { recursive: true })
    await writeFile(join(root, 'schema.json'), '{}\n', 'utf8')

    mockRunAgentInContainer.mockResolvedValue({
      exitCode: -1,
      stderr: 'context canceled\n',
      stdout: '{"type":"item.completed"}\n'
    })
    mockReadCodexLastMessage.mockResolvedValue(
      JSON.stringify({
        status: 'error',
        startedAt: '2026-03-13T17:26:39.000Z',
        completedAt: '2026-03-13T17:31:17.000Z',
        durationMs: 278000,
        findings: [],
        assertionResults: [],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      })
    )

    const loggerWarnSpy = vi.spyOn(logger, 'warn')
    const adapter = new CodexAdapter()

    const result = await adapter.run(
      createRunContext({
        root
      })
    )

    expect(result.result.status).toBe('error')
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      `Codex exited with code -1, but BugScrub recovered the structured run result from ${join(root, 'debug')}/codex-last-message.json.`
    )
  })
})
