import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runInitCommand } from '../../../src/commands/init.js'
import { runValidateCommand } from '../../../src/commands/validate.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))

const tempDirectories: string[] = []

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
      cwd: repoPath,
      dryRun: false,
      editor: 'vscode',
      force: false,
      selectPackage: async ({ packages }) => packages[0]!
    })

    await expect(runValidateCommand({ cwd: repoPath })).resolves.toBeUndefined()

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
      cwd: repoPath,
      dryRun: false,
      editor: undefined,
      force: false,
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

  it('falls back to a minimal TODO scaffold when no framework is detected', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'no-framework'
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInitCommand({
      cwd: repoPath,
      dryRun: false,
      editor: undefined,
      force: false,
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
})
