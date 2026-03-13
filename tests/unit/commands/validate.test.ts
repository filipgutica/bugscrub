import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runValidateCommand } from '../../../src/commands/validate.js'
import { CliError } from '../../../src/utils/errors.js'

const fixturesDir = fileURLToPath(new URL('../../fixtures/repos/', import.meta.url))
const tempDirectories: string[] = []

describe('runValidateCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    return Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('passes for a valid workspace', async () => {
    const successSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)

    await expect(
      runValidateCommand({ cwd: join(fixturesDir, 'workspace-valid') })
    ).resolves.toBeUndefined()

    expect(successSpy).toHaveBeenCalled()
  })

  it('fails with actionable errors for invalid references', async () => {
    await expect(
      runValidateCommand({ cwd: join(fixturesDir, 'workspace-invalid') })
    ).rejects.toMatchObject({
      exitCode: 1
    })

    try {
      await runValidateCommand({ cwd: join(fixturesDir, 'workspace-invalid') })
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect((error as CliError).message).toContain('missing capability')
      expect((error as CliError).message).toContain('missing success signal')
    }
  })

  it('accepts anonymous identities that do not require auth material', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'bugscrub-validate-'))
    tempDirectories.push(workspaceRoot)

    await mkdir(join(workspaceRoot, '.bugscrub', 'workflows'), { recursive: true })

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: vue-rbac-app',
        'defaultEnv: local',
        'envs:',
        '  local:',
        '    baseUrl: http://localhost:5173',
        '    defaultIdentity: anonymous',
        '    identities:',
        '      anonymous:',
        '        auth:',
        '          type: none',
        'agent:',
        '  preferred: auto',
        '  timeout: 300',
        '  maxBudgetUsd: 5',
        '  maxSteps: 20',
        ''
      ].join('\n'),
      'utf8'
    )

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'workflows', 'rbac-identity-regression.yaml'),
      [
        'version: "0"',
        'name: rbac-identity-regression',
        'target:',
        '  surface: rbac-console',
        '  env: local',
        'requires: []',
        'setup: []',
        'exploration:',
        '  tasks: []',
        'hard_assertions: []',
        'evidence:',
        '  screenshots: false',
        '  network_logs: false',
        ''
      ].join('\n'),
      'utf8'
    )

    await mkdir(join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console'), {
      recursive: true
    })

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'surface.yaml'),
      [
        'version: "0"',
        'name: rbac-console',
        'routes:',
        '  - /',
        'capabilities: []',
        'elements: {}',
        ''
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'capabilities.yaml'),
      '[]\n',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'assertions.yaml'),
      '[]\n',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'signals.yaml'),
      '[]\n',
      'utf8'
    )

    await expect(runValidateCommand({ cwd: workspaceRoot })).resolves.toBeUndefined()
  })

  it('accepts an explicit localRuntime block for container-managed app startup', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'bugscrub-validate-'))
    tempDirectories.push(workspaceRoot)

    await mkdir(join(workspaceRoot, '.bugscrub', 'workflows'), { recursive: true })

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: vue-rbac-app',
        'defaultEnv: local',
        'envs:',
        '  local:',
        '    baseUrl: http://localhost:5173',
        '    defaultIdentity: anonymous',
        '    identities:',
        '      anonymous:',
        '        auth:',
        '          type: none',
        '    localRuntime:',
        '      cwd: .',
        '      installCommand: test -d node_modules || pnpm install --frozen-lockfile',
        '      startCommand: pnpm dev --port 5173',
        '      readyPath: /',
        '      readyTimeoutMs: 120000',
        'agent:',
        '  preferred: auto',
        '  timeout: 300',
        '  maxBudgetUsd: 5',
        '  maxSteps: 20',
        ''
      ].join('\n'),
      'utf8'
    )

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'workflows', 'rbac-identity-regression.yaml'),
      [
        'version: "0"',
        'name: rbac-identity-regression',
        'target:',
        '  surface: rbac-console',
        '  env: local',
        'requires: []',
        'setup: []',
        'exploration:',
        '  tasks: []',
        'hard_assertions: []',
        'evidence:',
        '  screenshots: false',
        '  network_logs: false',
        ''
      ].join('\n'),
      'utf8'
    )

    await mkdir(join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console'), {
      recursive: true
    })

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'surface.yaml'),
      [
        'version: "0"',
        'name: rbac-console',
        'routes:',
        '  - /',
        'capabilities: []',
        'elements: {}',
        ''
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'capabilities.yaml'),
      '[]\n',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'assertions.yaml'),
      '[]\n',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'signals.yaml'),
      '[]\n',
      'utf8'
    )

    await expect(runValidateCommand({ cwd: workspaceRoot })).resolves.toBeUndefined()
  })

  it('fails when workflow requires contains unsupported free-form text', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'bugscrub-validate-'))
    tempDirectories.push(workspaceRoot)

    await mkdir(join(workspaceRoot, '.bugscrub', 'workflows'), { recursive: true })
    await mkdir(join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console'), {
      recursive: true
    })

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: vue-rbac-app',
        'defaultEnv: local',
        'envs:',
        '  local:',
        '    baseUrl: http://localhost:5173',
        '    defaultIdentity: anonymous',
        '    identities:',
        '      anonymous:',
        '        auth:',
        '          type: none',
        'agent:',
        '  preferred: auto',
        '  timeout: 300',
        '  maxBudgetUsd: 5',
        '  maxSteps: 20',
        ''
      ].join('\n'),
      'utf8'
    )

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'workflows', 'rbac-identity-regression.yaml'),
      [
        'version: "0"',
        'name: rbac-identity-regression',
        'target:',
        '  surface: rbac-console',
        '  env: local',
        'requires:',
        '  - Starts from /.',
        'setup: []',
        'exploration:',
        '  tasks: []',
        'hard_assertions: []',
        'evidence:',
        '  screenshots: false',
        '  network_logs: false',
        ''
      ].join('\n'),
      'utf8'
    )

    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'surface.yaml'),
      [
        'version: "0"',
        'name: rbac-console',
        'routes:',
        '  - /',
        'capabilities: []',
        'elements: {}',
        ''
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'capabilities.yaml'),
      '[]\n',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'assertions.yaml'),
      '[]\n',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, '.bugscrub', 'surfaces', 'rbac-console', 'signals.yaml'),
      '[]\n',
      'utf8'
    )

    await expect(runValidateCommand({ cwd: workspaceRoot })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining(
        'requires contains unsupported capability requirement "Starts from /."'
      )
    })
  })
})
