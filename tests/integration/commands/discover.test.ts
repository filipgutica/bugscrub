import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runDiscoverCommand } from '../../../src/commands/discover.js'
import { runValidateCommand } from '../../../src/commands/validate.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))
const tempDirectories: string[] = []

const createTempRepo = async ({
  fixtureName
}: {
  fixtureName: string
}): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'bugscrub-discover-'))
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

describe('runDiscoverCommand', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('authors missing repo coverage in an initialized repo', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'workspace-valid'
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

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
            '  env: staging',
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

      expect(prompt).toContain('Existing surfaces: api_requests')
      expect(prompt).toContain('Existing workflows: api-requests-exploration')
      expect(prompt).toContain('Author missing surfaces')

      return {
        agent: 'codex' as const,
        logPath: join(cwd, '.bugscrub', 'authoring-codex.log'),
        stderr: '',
        stdout: 'discovered'
      }
    })

    await runDiscoverCommand({
      authorRepo,
      cwd: repoPath,
      dryRun: false,
      selectPackage: async ({ packages }) => packages[0]!
    })

    expect(authorRepo).toHaveBeenCalledTimes(1)
    await expect(runValidateCommand({ cwd: repoPath })).resolves.toBeUndefined()
    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'discover-report.md')
      })
    ).toBe(true)
    expect(
      await pathExists({
        path: join(repoPath, '.bugscrub', 'discover-handoff.md')
      })
    ).toBe(true)

    const discoverHandoff = await readFile(
      join(repoPath, '.bugscrub', 'discover-handoff.md'),
      'utf8'
    )

    expect(discoverHandoff).toContain('Existing surfaces: api_requests')
  })

  it('targets a filtered pnpm workspace package without prompting', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'pnpm-workspace'
    })
    const adminRoot = join(repoPath, 'apps', 'admin')
    await mkdir(join(adminRoot, '.bugscrub'), { recursive: true })
    await writeFile(
      join(adminRoot, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: workspace-admin',
        'defaultEnv: local',
        'envs:',
        '  local:',
        '    baseUrl: http://localhost:4173',
        '    defaultIdentity: user',
        '    identities:',
        '      user:',
        '        auth:',
        '          type: token-env',
        '          tokenEnvVar: BUGSCRUB_TOKEN',
        'agent:',
        '  preferred: codex',
        '  timeout: 300',
        '  maxBudgetUsd: 5'
      ].join('\n'),
      'utf8'
    )
    const selectPackage = vi.fn(async () => {
      throw new Error('workspace selection should not be prompted when --filter is used')
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const authorRepo = vi.fn(async ({ cwd }: { cwd: string; prompt: string }) => {
      await Promise.all([
        mkdir(join(cwd, '.bugscrub', 'surfaces', 'admin'), { recursive: true }),
        mkdir(join(cwd, '.bugscrub', 'workflows'), { recursive: true })
      ])

      await Promise.all([
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'admin', 'surface.yaml'),
          [
            'name: admin',
            'routes:',
            '  - /admin',
            'elements:',
            '  admin_page:',
            '    test_id: admin-page',
            'capabilities:',
            '  - open_admin'
          ].join('\n'),
          'utf8'
        ),
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'admin', 'capabilities.yaml'),
          [
            '- name: open_admin',
            '  description: Open the admin page.',
            '  preconditions: []',
            '  guidance:',
            '    - Navigate to the admin page.',
            '  success_signals: []',
            '  failure_signals: []'
          ].join('\n'),
          'utf8'
        ),
        writeFile(
          join(cwd, '.bugscrub', 'surfaces', 'admin', 'assertions.yaml'),
          [
            '- name: admin_page_visible',
            '  kind: dom_presence',
            '  description: The admin page is visible.',
            '  match:',
            '    test_id: admin-page'
          ].join('\n'),
          'utf8'
        ),
        writeFile(join(cwd, '.bugscrub', 'surfaces', 'admin', 'signals.yaml'), '[]\n', 'utf8'),
        writeFile(
          join(cwd, '.bugscrub', 'workflows', 'admin-exploration.yaml'),
          [
            'name: admin-exploration',
            'target:',
            '  surface: admin',
            '  env: local',
            'setup: []',
            'exploration:',
            '  tasks:',
            '    - capability: open_admin',
            '      min: 1',
            '      max: 1',
            'hard_assertions:',
            '  - admin_page_visible',
            'evidence:',
            '  screenshots: true',
            '  network_logs: false'
          ].join('\n'),
          'utf8'
        )
      ])

      return {
        agent: 'codex' as const,
        logPath: join(cwd, '.bugscrub', 'authoring-codex.log'),
        stderr: '',
        stdout: 'discovered'
      }
    })

    await runDiscoverCommand({
      authorRepo,
      cwd: repoPath,
      dryRun: false,
      filter: 'workspace-admin',
      selectPackage
    })

    expect(selectPackage).not.toHaveBeenCalled()
    expect(authorRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: adminRoot
      })
    )
    expect(
      await pathExists({
        path: join(adminRoot, '.bugscrub', 'discover-report.md')
      })
    ).toBe(true)
  })
})
