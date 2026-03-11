import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { selectWorkspacePackage } from '../../../src/init/package-selection.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))
const tempDirectories: string[] = []

const createTempRepo = async ({
  fixtureName
}: {
  fixtureName: string
}): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'bugscrub-package-select-'))
  const targetPath = join(tempDirectory, fixtureName)
  await cp(join(fixturesDir, fixtureName), targetPath, { recursive: true })
  tempDirectories.push(tempDirectory)
  return targetPath
}

describe('selectWorkspacePackage', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('selects a workspace by relative path filter', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'pnpm-workspace'
    })

    await expect(
      selectWorkspacePackage({
        cwd: repoPath,
        filter: 'apps/web'
      })
    ).resolves.toMatchObject({
      packageRoot: join(repoPath, 'apps', 'web'),
      selectedPackage: {
        packageName: 'workspace-web',
        relativePath: 'apps/web'
      }
    })
  })

  it('selects a workspace by package name filter', async () => {
    const repoPath = await createTempRepo({
      fixtureName: 'pnpm-workspace'
    })

    await expect(
      selectWorkspacePackage({
        cwd: repoPath,
        filter: 'workspace-admin'
      })
    ).resolves.toMatchObject({
      packageRoot: join(repoPath, 'apps', 'admin'),
      selectedPackage: {
        packageName: 'workspace-admin',
        relativePath: 'apps/admin'
      }
    })
  })
})
