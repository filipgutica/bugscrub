import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runInitCommand } from '../../../src/commands/init.js'
import { runValidateCommand } from '../../../src/commands/validate.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))

const tempDirectories: string[] = []

const noopAuthorRepo = vi.fn(async () => ({
  agent: 'codex' as const,
  logPath: '/tmp/authoring-codex.log',
  stderr: '',
  stdout: ''
}))

const createTempRepo = async ({
  fixtureName
}: {
  fixtureName: string
}): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'bugscrub-init-'))
  const targetPath = join(tempDirectory, fixtureName)
  await cp(join(fixturesDir, fixtureName), targetPath, { recursive: true })
  tempDirectories.push(tempDirectory)
  return targetPath
}

const pathExists = async ({
  path
}: {
  path: string
}): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('runInitCommand', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    noopAuthorRepo.mockClear()
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('bootstraps a minimal valid scaffold and writes VS Code settings', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'simple-nextjs'
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInitCommand({
      authorRepo: noopAuthorRepo,
      cwd: repoPath,
      dryRun: false,
      editor: 'vscode',
      selectPackage: async ({ packages }) => packages[0]!
    })

    await expect(runValidateCommand({ cwd: repoPath })).resolves.toBeUndefined()
    expect(noopAuthorRepo).toHaveBeenCalledTimes(1)

    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'init-report.md')
      })
    ).toBe(true)
    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'agent-handoff.md')
      })
    ).toBe(true)
    expect(
      await pathExists({
        path: join(repoPath, '.vscode', 'settings.json')
      })
    ).toBe(true)
    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'workflows', 'settings-exploration.yaml')
      })
    ).toBe(false)

    const reportSource = await readFile(
      join(repoPath, '.bugscrub', 'init-report.md'),
      'utf8'
    )
    const handoffSource = await readFile(
      join(repoPath, '.bugscrub', 'agent-handoff.md'),
      'utf8'
    )

    expect(reportSource).toContain('Surface and workflow YAML files were intentionally left for the agent to author.')
    expect(reportSource).toContain('app/page.tsx')
    expect(handoffSource).toContain('Create repo-specific surfaces under `.bugscrub/surfaces/<surface>/`.')
  })

  it('selects a pnpm workspace package before writing scaffold files', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'pnpm-workspace'
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInitCommand({
      authorRepo: noopAuthorRepo,
      cwd: repoPath,
      dryRun: false,
      editor: undefined,
      selectPackage: async ({ packages }) =>
        packages.find((pkg) => pkg.relativePath === 'apps/admin') ?? packages[0]!
    })

    expect(
      await pathExists({
        path: join(repoPath, 'apps', 'admin', '.bugscrub', 'bugscrub.config.yaml')
      })
    ).toBe(true)
    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'bugscrub.config.yaml')
      })
    ).toBe(false)

    await expect(
      runValidateCommand({ cwd: join(repoPath, 'apps', 'admin') })
    ).resolves.toBeUndefined()
  })

  it('targets a pnpm workspace package via --filter semantics without prompting', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'pnpm-workspace'
    })
    const selectPackage = vi.fn(async ({ packages }: { packages: Array<{ relativePath: string }> }) => {
      return packages[0] as never
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInitCommand({
      authorRepo: noopAuthorRepo,
      cwd: repoPath,
      dryRun: false,
      editor: undefined,
      filter: 'apps/web',
      selectPackage
    })

    expect(selectPackage).not.toHaveBeenCalled()
    expect(
      await pathExists({
        path: join(repoPath, 'apps', 'web', '.bugscrub', 'bugscrub.config.yaml')
      })
    ).toBe(true)
    expect(
      await pathExists({
        path: join(repoPath, 'apps', 'admin', '.bugscrub', 'bugscrub.config.yaml')
      })
    ).toBe(false)
  })

  it('falls back to a minimal TODO scaffold when no framework is detected', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'no-framework'
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInitCommand({
      authorRepo: noopAuthorRepo,
      cwd: repoPath,
      dryRun: false,
      editor: undefined,
      selectPackage: async ({ packages }) => packages[0]!
    })

    await expect(runValidateCommand({ cwd: repoPath })).resolves.toBeUndefined()

    const configSource = await readFile(
      join(repoPath, '.bugscrub', 'bugscrub.config.yaml'),
      'utf8'
    )
    const reportSource = await readFile(
      join(repoPath, '.bugscrub', 'init-report.md'),
      'utf8'
    )
    const handoffSource = await readFile(
      join(repoPath, '.bugscrub', 'agent-handoff.md'),
      'utf8'
    )

    expect(configSource).toContain('https://example.com')
    expect(reportSource).toContain('placeholder')
    expect(handoffSource).toContain('Replace placeholder values in `.bugscrub/bugscrub.config.yaml` where needed.')
  })

  it('fails when init is run against an already initialized repo', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })

    await expect(
      runInitCommand({
        authorRepo: noopAuthorRepo,
        cwd: repoPath,
        dryRun: false,
        editor: undefined,
        selectPackage: async ({ packages }) => packages[0]!
      })
    ).rejects.toMatchObject({
      exitCode: 1
    })
  })

  it('invokes an authoring agent by default after scaffolding', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'simple-nextjs'
    })
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const authorRepo = vi.fn(async ({ cwd, prompt }: { cwd: string; prompt: string }) => {
      await Promise.all([
        mkdir(join(cwd, '.bugscrub', 'surfaces', 'settings'), { recursive: true }),
        mkdir(join(cwd, '.bugscrub', 'workflows'), { recursive: true })
      ])

      await Promise.all([
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'settings', 'surface.yaml'),
          [
            'name: settings',
            'routes:',
            '  - /settings',
            'elements:',
            '  settings_page:',
            '    test_id: settings-page',
            'capabilities:',
            '  - open_settings'
          ].join('\n'),
          'utf8'
        ),
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'settings', 'capabilities.yaml'),
          [
            '- name: open_settings',
            '  description: Open the settings page.',
            '  preconditions: []',
            '  guidance:',
            '    - Navigate to the settings page.',
            '  success_signals: []',
            '  failure_signals: []'
          ].join('\n'),
          'utf8'
        ),
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'settings', 'assertions.yaml'),
          [
            '- name: settings_page_visible',
            '  kind: dom_presence',
            '  description: The settings page is visible.',
            '  match:',
            '    test_id: settings-page'
          ].join('\n'),
          'utf8'
        ),
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'settings', 'signals.yaml'),
          '[]\n',
          'utf8'
        ),
        writeFile(
          join(cwd, '.bugscrub', 'workflows', 'settings-exploration.yaml'),
          [
            'name: settings-exploration',
            'target:',
            '  surface: settings',
            '  env: local',
            'setup: []',
            'exploration:',
            '  tasks:',
            '    - capability: open_settings',
            '      min: 1',
            '      max: 1',
            'hard_assertions:',
            '  - settings_page_visible',
            'evidence:',
            '  screenshots: true',
            '  network_logs: false'
          ].join('\n'),
          'utf8'
        )
      ])

      expect(prompt).toContain('Create repo-specific surfaces under `.bugscrub/surfaces/<surface>/`.')
      expect(prompt).toContain('Create repo-specific workflows under `.bugscrub/workflows/`.')

      return {
        agent: 'codex' as const,
        authoredFiles: [
          '.bugscrub/surfaces/settings/surface.yaml',
          '.bugscrub/surfaces/settings/capabilities.yaml',
          '.bugscrub/surfaces/settings/assertions.yaml',
          '.bugscrub/surfaces/settings/signals.yaml',
          '.bugscrub/workflows/settings-exploration.yaml'
        ],
        logPath: join(cwd, '.bugscrub', 'authoring-codex.log'),
        stderr: '',
        stdout: 'authored'
      }
    })

    await runInitCommand({
      authorRepo,
      cwd: repoPath,
      dryRun: false,
      editor: undefined,
      selectPackage: async ({ packages }) => packages[0]!
    })

    expect(authorRepo).toHaveBeenCalledTimes(1)
    await expect(runValidateCommand({ cwd: repoPath })).resolves.toBeUndefined()
    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'workflows', 'settings-exploration.yaml')
      })
    ).toBe(true)

    expect(
      writeSpy.mock.calls.some(([value]) =>
        String(value).includes('Files written: 8.')
      )
    ).toBe(true)
  })
})
