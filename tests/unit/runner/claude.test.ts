import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/agent-runtime/container.js', () => ({
  detectAvailableContainerAgents: vi.fn(),
  runAgentInContainer: vi.fn()
}))

import { ClaudeAdapter } from '../../../src/runner/agent/claude.js'
import { runAgentInContainer } from '../../../src/agent-runtime/container.js'
import type { RunContext } from '../../../src/runner/agent/types.js'

const mockRunAgentInContainer = vi.mocked(runAgentInContainer)

const createRunContext = (): RunContext => {
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
      name: 'claude'
    },
    artifacts: {
      debugDir: '/tmp/debug',
      networkDir: '/tmp/network',
      promptPath: '/tmp/prompt.md',
      reportJsonPath: '/tmp/report.json',
      reportMarkdownPath: '/tmp/report.md',
      responseSchemaPath: '/tmp/schema.json',
      screenshotsDir: '/tmp/screenshots',
      transcriptPath: '/tmp/transcript.jsonl'
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
        preferred: 'claude',
        timeout: 300,
        maxBudgetUsd: 5
      }
    },
    cwd: '/tmp',
    containerSessionRoot: '/tmp/session',
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
      directoryPath: '/tmp/surface',
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

describe('ClaudeAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockRunAgentInContainer.mockReset()
  })

  it('runs without the dangerous-permissions bypass flag', async () => {
    mockRunAgentInContainer.mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
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
    })

    const adapter = new ClaudeAdapter()
    const result = await adapter.run(createRunContext())

    expect(mockRunAgentInContainer).toHaveBeenCalledWith({
      agent: 'claude',
      cwd: '/tmp',
      prompt: 'prompt',
      schemaPath: '/tmp/schema.json',
      sessionRoot: '/tmp/session',
      timeoutMs: 30_000
    })
    expect(result.result.status).toBe('passed')
  })
})
