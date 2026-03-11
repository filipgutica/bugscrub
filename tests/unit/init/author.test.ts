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
  pinAuthoringAgentPreference,
  renderTranscriptText,
  redactSensitiveText,
  selectAuthoringAgent,
  shouldCopyAuthoringPath,
  syncAuthoredWorkspace
} from '../../../src/init/author.js'
import { CliError } from '../../../src/utils/errors.js'
import { stripAnsi } from '../../../src/utils/logger.js'
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
        ANTHROPIC_API_KEY: 'anthropic-secret',
        BUGSCRUB_TOKEN: 'should-not-leak',
        DB_PASSWORD: 'should-not-leak',
        HOME: '/Users/example',
        NODE_OPTIONS: '--require fake-auto-attach.js',
        NODE_INSPECT_RESUME_ON_START: '1',
        PATH: '/usr/bin',
        SHELL: '/bin/zsh',
        VSCODE_INSPECTOR_OPTIONS: '{"inspectorIpc":"/tmp/node-cdp.sock"}'
      },
      pathPrefix: '/tmp/bugscrub-bin'
    })

    expect(env.ANTHROPIC_API_KEY).toBe('anthropic-secret')
    expect(env.BUGSCRUB_TOKEN).toBeUndefined()
    expect(env.DB_PASSWORD).toBeUndefined()
    expect(env.HOME).toBe('/Users/example')
    expect(env.PATH).toBe(`/tmp/bugscrub-bin:${'/usr/bin'}`)
    expect(env.SHELL).toBe('/bin/zsh')
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.NODE_INSPECT_RESUME_ON_START).toBeUndefined()
    expect(env.VSCODE_INSPECTOR_OPTIONS).toBeUndefined()
  })

  it('redacts sensitive env values from authoring logs', () => {
    expect(
      redactSensitiveText({
        env: {
          ANTHROPIC_API_KEY: 'anthropic-secret',
          PATH: '/usr/bin'
        },
        text: 'token=anthropic-secret path=/usr/bin'
      })
    ).toBe('token=[REDACTED:ANTHROPIC_API_KEY] path=/usr/bin')
  })

  it('skips common secret files from the isolated authoring workspace', () => {
    expect(
      shouldCopyAuthoringPath({
        source: '/repo/.env.local'
      })
    ).toBe(false)
    expect(
      shouldCopyAuthoringPath({
        source: '/repo/service-account-prod.json'
      })
    ).toBe(false)
    expect(
      shouldCopyAuthoringPath({
        source: '/repo/src/App.tsx'
      })
    ).toBe(true)
  })

  it('wraps markdown-style authoring output for narrow terminals', () => {
    expect(
      stripAnsi({
        value: renderTranscriptText({
          stderr: false,
          text: [
            '# Summary',
            '- This is a long bullet that should wrap cleanly instead of spilling across the terminal width.',
            '```ts',
            'const featureFlag = true && shouldWrapAcrossMultipleColumnsForReadability',
            '```'
          ].join('\n'),
          width: 42
        })
      }).split('\n')
    ).toEqual([
      '# Summary',
      '- This is a long bullet that should wrap',
      ' cleanly instead of spilling across the',
      ' terminal width.',
      '```ts',
      '  const featureFlag = true &&',
      '  shouldWrapAcrossMultipleColumnsForReadab',
      '  ility',
      '```'
    ])
  })

  it('collapses noisy generated diffs in the streamed transcript', () => {
    expect(
      stripAnsi({
        value: renderTranscriptText({
          stderr: false,
          text: [
            'diff --git a/dist/assets/index.js b/dist/assets/index.js',
            'index 1111111..2222222 100644',
            '--- a/dist/assets/index.js',
            '+++ b/dist/assets/index.js',
            '@@ -1 +1 @@',
            '-const minifiedBundle="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
            '+const minifiedBundle="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";'
          ].join('\n'),
          width: 48
        })
      })
    ).toMatchInlineSnapshot(`
      "diff --git a/dist/assets/index.js
      b/dist/assets/index.js
      index 1111111..2222222 100644
      --- a/dist/assets/index.js
      +++ b/dist/assets/index.js
      @@ -1 +1 @@
      ... generated diff content for dist/assets/index.js truncated for display"
    `)
  })

  it('pins the selected authoring agent in the isolated workspace config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bugscrub-author-config-'))
    tempDirectories.push(root)
    await mkdir(join(root, '.bugscrub'), { recursive: true })
    await writeFile(
      join(root, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: bugscrub',
        'defaultEnv: local',
        'envs:',
        '  local:',
        '    baseUrl: http://localhost:3000',
        '    defaultIdentity: user',
        '    identities:',
        '      user:',
        '        auth:',
        '          type: token-env',
        '          tokenEnvVar: BUGSCRUB_TOKEN',
        'agent:',
        '  preferred: auto',
        '  timeout: 300',
        '  maxBudgetUsd: 5'
      ].join('\n'),
      'utf8'
    )

    await pinAuthoringAgentPreference({
      agent: 'codex',
      tempWorkspaceRoot: root
    })

    expect(await readFile(join(root, '.bugscrub', 'bugscrub.config.yaml'), 'utf8')).toContain(
      'preferred: codex'
    )
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

  it('rejects authored changes outside .bugscrub before syncing results back', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bugscrub-author-test-'))
    const tempWorkspaceRoot = await mkdtemp(join(tmpdir(), 'bugscrub-author-staging-'))
    tempDirectories.push(cwd, tempWorkspaceRoot)

    await Promise.all([
      mkdir(join(cwd, '.bugscrub'), { recursive: true }),
      mkdir(join(cwd, 'src'), { recursive: true }),
      mkdir(join(tempWorkspaceRoot, '.bugscrub'), { recursive: true }),
      mkdir(join(tempWorkspaceRoot, 'src'), { recursive: true })
    ])

    await Promise.all([
      writeFile(join(cwd, '.bugscrub', 'bugscrub.config.yaml'), 'version: "0"\n', 'utf8'),
      writeFile(join(cwd, 'src', 'App.tsx'), 'export const App = () => null\n', 'utf8'),
      writeFile(join(tempWorkspaceRoot, '.bugscrub', 'bugscrub.config.yaml'), 'version: "0"\n', 'utf8'),
      writeFile(join(tempWorkspaceRoot, 'src', 'App.tsx'), 'export const App = () => <main />\n', 'utf8')
    ])

    await expect(
      syncAuthoredWorkspace({
        cwd,
        tempWorkspaceRoot
      })
    ).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('Unexpected edits were detected outside `.bugscrub/`')
    })

    expect(await readFile(join(cwd, 'src', 'App.tsx'), 'utf8')).toBe('export const App = () => null\n')
  })
})
