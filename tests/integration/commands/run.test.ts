import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { executeRun } from '../../../src/runner/index.js'
import { InvalidRunResultError } from '../../../src/runner/agent/result.js'
import { CliError } from '../../../src/utils/errors.js'
import type { AgentAdapter, AgentCapabilities, RepairOutputInput, RunContext } from '../../../src/runner/agent/types.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))
const tempDirectories: string[] = []

class FakeAdapter implements AgentAdapter {
  public readonly name = 'codex' as const
  public lastPrompt: string | undefined

  public async detect(): Promise<boolean> {
    return true
  }

  public async getCapabilities(): Promise<AgentCapabilities> {
    return {
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
  }

  public async run(context: RunContext) {
    this.lastPrompt = context.prompt

    return {
      artifacts: {
        stderr: '',
        stdout: '{"event":"completed"}\n'
      },
      rawResponse: JSON.stringify({
        status: 'passed',
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: context.hardAssertions.map((assertion) => ({
          assertion: assertion.name,
          status: 'passed' as const,
          summary: `${assertion.name} passed`
        })),
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }),
      result: {
        status: 'passed' as const,
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: context.hardAssertions.map((assertion) => ({
          assertion: assertion.name,
          status: 'passed' as const,
          summary: `${assertion.name} passed`
        })),
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }
    }
  }
}

class RepairingAdapter extends FakeAdapter {
  public repairCalls: RepairOutputInput[] = []

  public override async run(context: RunContext) {
    this.lastPrompt = context.prompt

    throw new InvalidRunResultError({
      agent: 'codex',
      issues: ['Missing required property: assertionResults'],
      rawOutput: '{"status":"passed"}'
    })
  }

  public async repairOutput(_context: RunContext, input: RepairOutputInput) {
    this.repairCalls.push(input)

    return {
      artifacts: {
        stderr: '',
        stdout: '{"event":"repair-completed"}\n'
      },
      rawResponse: JSON.stringify({
        status: 'passed',
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [
          {
            assertion: 'page_not_blank',
            status: 'passed' as const,
            summary: 'Visible.'
          },
          {
            assertion: 'api_requests_visible',
            status: 'passed' as const,
            summary: 'Visible.'
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }),
      result: {
        status: 'passed' as const,
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [
          {
            assertion: 'page_not_blank',
            status: 'passed' as const,
            summary: 'Visible.'
          },
          {
            assertion: 'api_requests_visible',
            status: 'passed' as const,
            summary: 'Visible.'
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }
    }
  }
}

class CoverageRepairingAdapter extends FakeAdapter {
  public repairCalls: RepairOutputInput[] = []

  public override async run(context: RunContext) {
    this.lastPrompt = context.prompt

    return {
      artifacts: {
        stderr: '',
        stdout: '{"event":"completed"}\n'
      },
      rawResponse: JSON.stringify({
        status: 'passed',
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [
          {
            assertion: 'page_not_blank',
            status: 'passed' as const,
            summary: 'Visible.'
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }),
      result: {
        status: 'passed' as const,
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [
          {
            assertion: 'page_not_blank',
            status: 'passed' as const,
            summary: 'Visible.'
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }
    }
  }

  public async repairOutput(_context: RunContext, input: RepairOutputInput) {
    this.repairCalls.push(input)

    return {
      artifacts: {
        stderr: '',
        stdout: '{"event":"repair-completed"}\n'
      },
      rawResponse: JSON.stringify({
        status: 'passed',
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [
          {
            assertion: 'page_not_blank',
            status: 'passed' as const,
            summary: 'Visible.'
          },
          {
            assertion: 'api_requests_visible',
            status: 'passed' as const,
            summary: 'Visible.'
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }),
      result: {
        status: 'passed' as const,
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [
          {
            assertion: 'page_not_blank',
            status: 'passed' as const,
            summary: 'Visible.'
          },
          {
            assertion: 'api_requests_visible',
            status: 'passed' as const,
            summary: 'Visible.'
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      }
    }
  }
}

class UndetectedAdapter extends FakeAdapter {
  public override async detect(): Promise<boolean> {
    return false
  }
}

class FailingAdapter extends FakeAdapter {
  public override async run(context: RunContext) {
    await writeFile(
      join(context.artifacts.debugDir, 'adapter-error.txt'),
      'container-side failure details\n',
      'utf8'
    )

    throw new CliError({
      message: 'agent exploded',
      exitCode: 1
    })
  }
}

const createTempRepo = async ({
  fixtureName
}: {
  fixtureName: string
}): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'bugscrub-run-'))
  const targetPath = join(tempDirectory, fixtureName)
  await cp(join(fixturesDir, fixtureName), targetPath, { recursive: true })
  tempDirectories.push(tempDirectory)
  return targetPath
}

describe('executeRun', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('builds a dry-run prompt preview without writing reports', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })

    const result = await executeRun({
      adapters: [new FakeAdapter()],
      cwd: repoPath,
      dryRun: true,
      maxSteps: 7,
      workflow: 'api-requests-exploration'
    })

    expect(result.dryRunOutput).toContain('Selected adapter: codex')
    expect(result.dryRunOutput).toContain('api-requests-exploration')
    expect(result.dryRunOutput).toContain('browser.dom.read')
    expect(result.dryRunOutput).toContain('Target: https://staging.example.com')
    expect(result.reportPaths).toBeUndefined()
  })

  it('supports dry-run previews even when no runtime is detected locally', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })

    const result = await executeRun({
      adapters: [new UndetectedAdapter()],
      cwd: repoPath,
      dryRun: true,
      maxSteps: 7,
      workflow: 'api-requests-exploration'
    })

    expect(result.dryRunOutput).toContain('Selected adapter: codex')
    expect(result.reportPaths).toBeUndefined()
  })

  it('describes a BugScrub-managed local runtime when the environment config declares one', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })

    await writeFile(
      join(repoPath, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: bugscrub-fixture',
        'defaultEnv: local',
        'envs:',
        '  local:',
        '    baseUrl: http://localhost:4173',
        '    defaultIdentity: admin',
        '    identities:',
        '      admin:',
        '        auth:',
        '          type: none',
        '    localRuntime:',
        '      cwd: .',
        '      startCommand: pnpm dev --port 4173',
        '      readyPath: /health',
        '      readyTimeoutMs: 45000',
        'agent:',
        '  preferred: auto',
        '  timeout: 300',
        '  maxBudgetUsd: 5',
        ''
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(repoPath, '.bugscrub', 'workflows', 'api-requests.yaml'),
      [
        'name: api-requests-exploration',
        'target:',
        '  surface: api_requests',
        '  env: local',
        'requires:',
        '  - browser.navigation',
        '  - browser.dom.read',
        '  - browser.network.observe',
        'setup:',
        '  - capability: login',
        'exploration:',
        '  tasks:',
        '    - capability: inspect_requests_list',
        '      min: 1',
        '      max: 2',
        'hard_assertions: []',
        'evidence:',
        '  screenshots: true',
        '  network_logs: true',
        ''
      ].join('\n'),
      'utf8'
    )

    const result = await executeRun({
      adapters: [new UndetectedAdapter()],
      cwd: repoPath,
      dryRun: true,
      maxSteps: 7,
      workflow: 'api-requests-exploration'
    })

    expect(result.dryRunOutput).toContain('BugScrub starts the configured local runtime in-container')
    expect(result.dryRunOutput).toContain('http://127.0.0.1:4173/health')
    expect(result.dryRunOutput).toContain('Target: http://127.0.0.1:4173')
  })

  it('writes prompt, transcript, and report artifacts for a live run', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const adapter = new FakeAdapter()

    const result = await executeRun({
      adapters: [adapter],
      cwd: repoPath,
      dryRun: false,
      maxSteps: undefined,
      workflow: 'api-requests-exploration'
    })

    expect(result.reportPaths?.json).toBeDefined()
    expect(result.reportPaths?.markdown).toBeDefined()

    const reportJson = await readFile(result.reportPaths!.json, 'utf8')
    const reportMarkdown = await readFile(result.reportPaths!.markdown, 'utf8')

    expect(reportJson).toContain('"agent": "codex"')
    expect(reportMarkdown).toContain('# BugScrub run report')
    expect(reportMarkdown).toContain('api-requests-exploration')

    const debugRoot = join(repoPath, '.bugscrub', 'debug')
    const promptFile = join(debugRoot, (await readFile(result.reportPaths!.json, 'utf8')).match(/"runId": "([^"]+)"/)?.[1] ?? '', 'prompt.md')
    const transcriptFile = join(debugRoot, (await readFile(result.reportPaths!.json, 'utf8')).match(/"runId": "([^"]+)"/)?.[1] ?? '', 'agent-transcript.jsonl')

    expect(await readFile(promptFile, 'utf8')).toContain('## Output format')
    expect(await readFile(promptFile, 'utf8')).toContain('## Runtime preparation')
    expect(await readFile(promptFile, 'utf8')).toContain('Verify that `https://staging.example.com` is reachable')
    expect(await readFile(promptFile, 'utf8')).toBe(adapter.lastPrompt)
    expect(await readFile(transcriptFile, 'utf8')).toContain('completed')
  })

  it('syncs .bugscrub debug artifacts back to the host when a live run fails', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })

    await expect(
      executeRun({
        adapters: [new FailingAdapter()],
        cwd: repoPath,
        dryRun: false,
        maxSteps: undefined,
        workflow: 'api-requests-exploration'
      })
    ).rejects.toMatchObject({
      exitCode: 1,
      message: 'agent exploded'
    })

    const debugRoot = join(repoPath, '.bugscrub', 'debug')
    const debugRunDirectories = await readdir(debugRoot)

    expect(debugRunDirectories).toHaveLength(1)
    expect(
      await readFile(join(debugRoot, debugRunDirectories[0]!, 'adapter-error.txt'), 'utf8')
    ).toBe('container-side failure details\n')
  })

  it('tells the agent to return an empty assertionResults array when the workflow has no hard assertions', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    await writeFile(
      join(repoPath, '.bugscrub', 'workflows', 'api-requests.yaml'),
      [
        'name: api-requests-exploration',
        'target:',
        '  surface: api_requests',
        '  env: staging',
        'requires:',
        '  - browser.navigation',
        '  - browser.dom.read',
        '  - browser.network.observe',
        'setup:',
        '  - capability: login',
        'exploration:',
        '  tasks:',
        '    - capability: inspect_requests_list',
        '      min: 1',
        '      max: 2',
        'hard_assertions: []',
        'evidence:',
        '  screenshots: true',
        '  network_logs: true',
        ''
      ].join('\n'),
      'utf8'
    )
    const adapter = new FakeAdapter()

    await executeRun({
      adapters: [adapter],
      cwd: repoPath,
      dryRun: false,
      maxSteps: undefined,
      workflow: 'api-requests-exploration'
    })

    expect(adapter.lastPrompt).toContain('This workflow has no hard assertions.')
    expect(adapter.lastPrompt).toContain('Set `assertionResults` to an empty array')
    expect(adapter.lastPrompt).toContain('Do not put capability names, task names, or free-form checks into `assertionResults`.')
  })

  it('repairs invalid structured output without rerunning the workflow', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const adapter = new RepairingAdapter()

    const result = await executeRun({
      adapters: [adapter],
      cwd: repoPath,
      dryRun: false,
      maxSteps: undefined,
      workflow: 'api-requests-exploration'
    })

    const reportJson = await readFile(result.reportPaths!.json, 'utf8')

    expect(adapter.repairCalls).toHaveLength(1)
    expect(adapter.repairCalls[0]?.previousOutput).toBe('{"status":"passed"}')
    expect(adapter.repairCalls[0]?.issues).toEqual(['Missing required property: assertionResults'])
    expect(reportJson).toContain('"assertion": "page_not_blank"')
  })

  it('requests a repair-only retry when assertion coverage is incomplete', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const adapter = new CoverageRepairingAdapter()

    const result = await executeRun({
      adapters: [adapter],
      cwd: repoPath,
      dryRun: false,
      maxSteps: undefined,
      workflow: 'api-requests-exploration'
    })

    const reportJson = await readFile(result.reportPaths!.json, 'utf8')

    expect(adapter.repairCalls).toHaveLength(1)
    expect(adapter.repairCalls[0]?.issues).toEqual([
      'Missing assertion result "api_requests_visible".'
    ])
    expect(reportJson).toContain('"assertion": "api_requests_visible"')
  })

})
