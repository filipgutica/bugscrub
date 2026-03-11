import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { executeRun } from '../../../src/runner/index.js'
import type { AgentAdapter, AgentCapabilities, RunContext } from '../../../src/runner/agent/types.js'

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
        raw: {
          adapter: 'fake'
        },
        stderr: '',
        stdout: '{"event":"completed"}\n'
      },
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
        },
        raw: {
          adapter: 'fake'
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
      ensureBrowserRuntimeConfigured: async () => {},
      maxSteps: 7,
      workflow: 'api-requests-exploration'
    })

    expect(result.dryRunOutput).toContain('Selected adapter: codex')
    expect(result.dryRunOutput).toContain('api-requests-exploration')
    expect(result.dryRunOutput).toContain('browser.dom.read')
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
      ensureBrowserRuntimeConfigured: async () => {},
      maxSteps: 7,
      workflow: 'api-requests-exploration'
    })

    expect(result.dryRunOutput).toContain('Selected adapter: codex')
    expect(result.reportPaths).toBeUndefined()
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
      ensureBrowserRuntimeConfigured: async () => {},
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
    expect(await readFile(promptFile, 'utf8')).toBe(adapter.lastPrompt)
    expect(await readFile(transcriptFile, 'utf8')).toContain('completed')
  })
})
