import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { detectProject, detectWorkspace } from '../../../src/init/detector.js'

const tempDirectories: string[] = []

const createTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'bugscrub-detector-'))
  tempDirectories.push(directory)
  return directory
}

describe('detectWorkspace', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('excludes the workspace root when it does not match workspace package globs', async () => {
    const root = await createTempDirectory()

    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    await writeFile(join(root, 'package.json'), '{"name":"workspace-root"}\n')
    await mkdir(join(root, 'apps', 'web'), { recursive: true })
    await writeFile(join(root, 'apps', 'web', 'package.json'), '{"name":"web"}\n')

    await expect(detectWorkspace({ cwd: root })).resolves.toMatchObject({
      isPnpmWorkspace: true,
      packages: [
        {
          relativePath: 'apps/web',
          packageName: 'web'
        }
      ]
    })
  })

  it('applies negated pnpm workspace globs after matching includes', async () => {
    const root = await createTempDirectory()

    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - "!apps/excluded"\n'
    )
    await mkdir(join(root, 'apps', 'included'), { recursive: true })
    await mkdir(join(root, 'apps', 'excluded'), { recursive: true })
    await writeFile(
      join(root, 'apps', 'included', 'package.json'),
      '{"name":"included"}\n'
    )
    await writeFile(
      join(root, 'apps', 'excluded', 'package.json'),
      '{"name":"excluded"}\n'
    )

    await expect(detectWorkspace({ cwd: root })).resolves.toMatchObject({
      isPnpmWorkspace: true,
      packages: [
        {
          relativePath: 'apps/included',
          packageName: 'included'
        }
      ]
    })
  })
})

describe('detectProject', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('recognizes Vite projects that use supported cjs and mts config files', async () => {
    const cjsRoot = await createTempDirectory()
    await writeFile(
      join(cjsRoot, 'package.json'),
      JSON.stringify({ name: 'cjs-app', dependencies: { react: '^19.0.0' } })
    )
    await writeFile(join(cjsRoot, 'vite.config.cjs'), 'module.exports = {}\n')

    const mtsRoot = await createTempDirectory()
    await writeFile(
      join(mtsRoot, 'package.json'),
      JSON.stringify({ name: 'mts-app', dependencies: { vue: '^3.0.0' } })
    )
    await writeFile(join(mtsRoot, 'vite.config.mts'), 'export default {}\n')

    await expect(detectProject({ root: cjsRoot })).resolves.toMatchObject({
      framework: 'vite-react'
    })
    await expect(detectProject({ root: mtsRoot })).resolves.toMatchObject({
      framework: 'vite-vue'
    })
  })
})
