import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  runSetupCommand,
  setupCommandInternals
} from '../../../src/commands/setup.js'
import { CliError } from '../../../src/utils/errors.js'

const tempDirectories: string[] = []

describe('runSetupCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    return Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('appends a local-dev shell function to a shell rc file', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-setup-'))
    const rcFile = join(tempRoot, '.zshrc')
    tempDirectories.push(tempRoot)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runSetupCommand({
      shellRcFile: rcFile
    })

    const contents = await readFile(rcFile, 'utf8')

    expect(contents).toContain(setupCommandInternals.LOCAL_DEV_BLOCK_START)
    expect(contents).toContain('bugscrub() {')
    expect(contents).toContain(
      `"${setupCommandInternals.resolveLocalCliEntryPath()}" "$@"`
    )
  })

  it('replaces an existing setup block instead of duplicating it', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-setup-'))
    const rcFile = join(tempRoot, '.zshrc')
    tempDirectories.push(tempRoot)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await writeFile(
      rcFile,
      [
        'export PATH="$HOME/bin:$PATH"',
        '',
        setupCommandInternals.buildShellSetupBlock({
          cliEntryPath: '/old/path/dist/bugscrub'
        }),
        ''
      ].join('\n'),
      'utf8'
    )

    await runSetupCommand({
      shellRcFile: rcFile
    })

    const contents = await readFile(rcFile, 'utf8')

    expect(contents.match(/bugscrub\(\)/g)).toHaveLength(1)
    expect(contents).not.toContain('/old/path/dist/bugscrub')
    expect(contents).toContain('export PATH="$HOME/bin:$PATH"')
  })

  it('fails when the built CLI is missing', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-setup-'))
    tempDirectories.push(tempRoot)

    await expect(
      runSetupCommand({
        projectRoot: tempRoot,
        shellRcFile: join(tempRoot, '.zshrc')
      })
    ).rejects.toBeInstanceOf(CliError)
  })
})
