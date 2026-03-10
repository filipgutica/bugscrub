import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runValidateCommand } from '../../../src/commands/validate.js'
import { CliError } from '../../../src/utils/errors.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))

describe('runValidateCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes for a valid workspace', async () => {
    const successSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)

    await expect(
      runValidateCommand({ cwd: join(fixturesDir, 'phase1-valid') })
    ).resolves.toBeUndefined()

    expect(successSpy).toHaveBeenCalled()
  })

  it('fails with actionable errors for invalid references', async () => {
    await expect(
      runValidateCommand({ cwd: join(fixturesDir, 'phase1-invalid') })
    ).rejects.toMatchObject({
      exitCode: 1
    })

    try {
      await runValidateCommand({ cwd: join(fixturesDir, 'phase1-invalid') })
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect((error as CliError).message).toContain('missing capability')
      expect((error as CliError).message).toContain('missing success signal')
    }
  })
})
