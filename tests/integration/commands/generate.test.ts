import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runGenerateCommand } from '../../../src/commands/generate.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))
const execFileAsync = promisify(execFile)
const tempDirectories: string[] = []

const createTempRepo = async ({
  fixtureName
}: {
  fixtureName: string
}): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'bugscrub-generate-'))
  const targetPath = join(tempDirectory, fixtureName)
  await cp(join(fixturesDir, fixtureName), targetPath, { recursive: true })
  tempDirectories.push(tempDirectory)
  return targetPath
}

const initializeGitRepo = async ({
  cwd
}: {
  cwd: string
}): Promise<void> => {
  await execFileAsync('git', ['init'], { cwd })
  await execFileAsync('git', ['add', '.'], { cwd })
  await execFileAsync(
    'git',
    ['-c', 'user.name=BugScrub', '-c', 'user.email=bugscrub@example.com', 'commit', '-m', 'init'],
    { cwd }
  )
}

describe('runGenerateCommand', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('renders a route-based dry-run draft for an existing surface', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runGenerateCommand({
      cwd: repoPath,
      dryRun: true,
      force: false,
      fromRoute: '/observability/api-requests'
    })

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('')

    expect(output).toContain('target:')
    expect(output).toContain('surface: api_requests')
    expect(output).toContain('inspect_requests_list')
  })

  it('clones an existing workflow into a draft', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runGenerateCommand({
      cwd: repoPath,
      dryRun: true,
      force: false,
      fromWorkflow: '.bugscrub/workflows/api-requests.yaml'
    })

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('')

    expect(output).toContain('name: api-requests-exploration-draft')
    expect(output).toContain('Source: workflow .bugscrub/workflows/api-requests.yaml')
  })

  it('generates a test-derived draft and writes it to workflows/', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    await mkdir(join(repoPath, 'tests'), { recursive: true })
    await writeFile(
      join(repoPath, 'package.json'),
      JSON.stringify({
        name: 'workspace-valid',
        devDependencies: {
          '@playwright/test': '^1.50.0'
        }
      }),
      'utf8'
    )

    await writeFile(
      join(repoPath, 'tests', 'settings.spec.ts'),
      [
        "import { test } from '@playwright/test'",
        '',
        "test('settings', async ({ page }) => {",
        "  await page.goto('/settings')",
        '})',
        ''
      ].join('\n'),
      'utf8'
    )

    await runGenerateCommand({
      cwd: repoPath,
      dryRun: false,
      force: false,
      promptForSource: async () => ({
        kind: 'tests'
      })
    })

    const generated = await readFile(
      join(repoPath, '.bugscrub', 'workflows', 'settings-exploration.yaml'),
      'utf8'
    )

    expect(generated).toContain('target:')
    expect(generated).toContain('surface: settings')
    expect(generated).toContain('TODO_define_capability_for_settings')
  })

  it('generates a diff-derived draft from local changes', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await initializeGitRepo({
      cwd: repoPath
    })
    await writeFile(
      join(repoPath, '.bugscrub', 'surfaces', 'api_requests', 'capabilities.yaml'),
      [
        '- name: login',
        '  description: Log in as the selected identity',
        '  preconditions: []',
        '  guidance:',
        '    - Start from a logged-out session',
        '  success_signals: []',
        '  failure_signals: []',
        '- name: inspect_requests_list',
        '  description: Inspect the requests list',
        '  preconditions:',
        '    - requests_table_visible',
        '  guidance:',
        '    - Verify the table renders rows',
        '    - Apply one extra filter to exercise the local diff path',
        '  success_signals:',
        '    - results_refresh',
        '  failure_signals:',
        '    - blank_surface',
        ''
      ].join('\n'),
      'utf8'
    )

    await runGenerateCommand({
      cwd: repoPath,
      dryRun: true,
      force: false,
      promptForSource: async () => ({
        kind: 'diff',
        diffMode: {
          kind: 'local'
        }
      })
    })

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('')

    expect(output).toContain('Source: current local changes')
    expect(output).toContain('surface: api_requests')
  })

  it('includes untracked files in local diff generation', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await initializeGitRepo({
      cwd: repoPath
    })
    await mkdir(join(repoPath, 'tests'), { recursive: true })
    await writeFile(
      join(repoPath, 'package.json'),
      JSON.stringify({
        name: 'workspace-valid',
        devDependencies: {
          '@playwright/test': '^1.50.0'
        }
      }),
      'utf8'
    )
    await writeFile(
      join(repoPath, 'tests', 'new-surface.spec.ts'),
      [
        "import { test } from '@playwright/test'",
        '',
        "test('new surface', async ({ page }) => {",
        "  await page.goto('/new-surface')",
        '})',
        ''
      ].join('\n'),
      'utf8'
    )

    await runGenerateCommand({
      cwd: repoPath,
      dryRun: true,
      force: false,
      promptForSource: async () => ({
        kind: 'diff',
        diffMode: {
          kind: 'local'
        }
      })
    })

    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('')

    expect(output).toContain('surface: new_surface')
    expect(output).toContain('TODO_define_capability_for_new_surface')
  })
})
