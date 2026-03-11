import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/runner/agent/process.js', () => ({
  isCommandAvailable: vi.fn(),
  runCommand: vi.fn()
}))

import {
  createAuthoringEnv,
  selectAuthoringAgent,
  syncAuthoredWorkspace
} from '../../../src/init/author.js'
import { CliError } from '../../../src/utils/errors.js'
import { isCommandAvailable } from '../../../src/runner/agent/process.js'

const mockIsCommandAvailable = vi.mocked(isCommandAvailable)
const tempDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  mockIsCommandAvailable.mockReset()
  return Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('selectAuthoringAgent', () => {
  it('uses the configured preferred agent when available', async () => {
    mockIsCommandAvailable
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(
      selectAuthoringAgent({
        config: {
          version: '0',
          project: 'bugscrub',
          defaultEnv: 'local',
          envs: {
            local: {
              baseUrl: 'http://localhost:3000',
              defaultIdentity: 'user',
              identities: {
                user: {
                  auth: {
                    type: 'token-env',
                    tokenEnvVar: 'BUGSCRUB_TOKEN'
                  }
                }
              }
            }
          },
          agent: {
            preferred: 'codex',
            timeout: 300,
            maxBudgetUsd: 5
          }
        }
      })
    ).resolves.toMatchObject({
      agent: 'codex'
    })
  })

  it('prompts for agent selection when preferred is auto and multiple runtimes are available', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true
    })
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true
    })
    mockIsCommandAvailable
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(
      selectAuthoringAgent({
        config: {
          version: '0',
          project: 'bugscrub',
          defaultEnv: 'local',
          envs: {
            local: {
              baseUrl: 'http://localhost:3000',
              defaultIdentity: 'user',
              identities: {
                user: {
                  auth: {
                    type: 'token-env',
                    tokenEnvVar: 'BUGSCRUB_TOKEN'
                  }
                }
              }
            }
          },
          agent: {
            preferred: 'auto',
            timeout: 300,
            maxBudgetUsd: 5
          }
        },
        promptForSelection: async () => 'codex'
      })
    ).resolves.toMatchObject({
      agent: 'codex',
      available: ['claude', 'codex']
    })
  })

  it('fails when preferred is auto, multiple runtimes exist, and there is no tty to prompt', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false
    })
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false
    })
    mockIsCommandAvailable
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(
      selectAuthoringAgent({
        config: {
          version: '0',
          project: 'bugscrub',
          defaultEnv: 'local',
          envs: {
            local: {
              baseUrl: 'http://localhost:3000',
              defaultIdentity: 'user',
              identities: {
                user: {
                  auth: {
                    type: 'token-env',
                    tokenEnvVar: 'BUGSCRUB_TOKEN'
                  }
                }
              }
            }
          },
          agent: {
            preferred: 'auto',
            timeout: 300,
            maxBudgetUsd: 5
          }
        }
      })
    ).rejects.toBeInstanceOf(CliError)
  })
})

describe('createAuthoringEnv', () => {
  it('strips debugger auto-attach environment from authoring subprocesses', () => {
    const env = createAuthoringEnv({
      baseEnv: {
        NODE_OPTIONS: '--require fake-auto-attach.js',
        NODE_INSPECT_RESUME_ON_START: '1',
        PATH: '/usr/bin',
        VSCODE_INSPECTOR_OPTIONS: '{"inspectorIpc":"/tmp/node-cdp.sock"}'
      },
      pathPrefix: '/tmp/bugscrub-bin'
    })

    expect(env.PATH).toBe(`/tmp/bugscrub-bin:${'/usr/bin'}`)
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.NODE_INSPECT_RESUME_ON_START).toBeUndefined()
    expect(env.VSCODE_INSPECTOR_OPTIONS).toBeUndefined()
  })
})

describe('syncAuthoredWorkspace', () => {
  it('keeps the existing workspace when the authored copy is missing .bugscrub', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bugscrub-author-test-'))
    const tempWorkspaceRoot = await mkdtemp(join(tmpdir(), 'bugscrub-author-staging-'))
    tempDirectories.push(cwd, tempWorkspaceRoot)

    await mkdir(join(cwd, '.bugscrub'), { recursive: true })
    await writeFile(join(cwd, '.bugscrub', 'bugscrub.config.yaml'), 'version: "0"\n', 'utf8')

    await expect(
      syncAuthoredWorkspace({
        cwd,
        tempWorkspaceRoot
      })
    ).rejects.toBeDefined()

    expect(
      await readFile(join(cwd, '.bugscrub', 'bugscrub.config.yaml'), 'utf8')
    ).toBe('version: "0"\n')
  })
})
