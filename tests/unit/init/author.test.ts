import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/runner/agent/process.js', () => ({
  isCommandAvailable: vi.fn(),
  runCommand: vi.fn()
}))

vi.mock('../../../src/agent-runtime/container.js', () => ({
  createDisposableWorkspace: vi.fn(),
  detectAvailableContainerAgents: vi.fn(),
  ensureDockerRuntime: vi.fn(),
  runAgentInContainer: vi.fn(),
  syncBugscrubWorkspace: vi.fn()
}))

import {
  authorWorkspace,
  renderTranscriptText,
  redactSensitiveText,
  selectAuthoringAgent
} from '../../../src/init/author.js'
import {
  createDisposableWorkspace,
  detectAvailableContainerAgents,
  ensureDockerRuntime,
  runAgentInContainer,
  syncBugscrubWorkspace
} from '../../../src/agent-runtime/container.js'
import { CliError } from '../../../src/utils/errors.js'
import { stripAnsi } from '../../../src/utils/logger.js'
import { isCommandAvailable, runCommand } from '../../../src/runner/agent/process.js'

const mockIsCommandAvailable = vi.mocked(isCommandAvailable)
const mockRunCommand = vi.mocked(runCommand)
const mockCreateDisposableWorkspace = vi.mocked(createDisposableWorkspace)
const mockDetectAvailableContainerAgents = vi.mocked(detectAvailableContainerAgents)
const mockEnsureDockerRuntime = vi.mocked(ensureDockerRuntime)
const mockRunAgentInContainer = vi.mocked(runAgentInContainer)
const mockSyncBugscrubWorkspace = vi.mocked(syncBugscrubWorkspace)
const tempDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  mockIsCommandAvailable.mockReset()
  mockRunCommand.mockReset()
  mockCreateDisposableWorkspace.mockReset()
  mockDetectAvailableContainerAgents.mockReset()
  mockEnsureDockerRuntime.mockReset()
  mockRunAgentInContainer.mockReset()
  mockSyncBugscrubWorkspace.mockReset()
  return Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('selectAuthoringAgent', () => {
  it('uses the configured preferred agent when available', async () => {
    mockDetectAvailableContainerAgents.mockResolvedValueOnce(['claude', 'codex'])

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
    mockDetectAvailableContainerAgents.mockResolvedValueOnce(['claude', 'codex'])

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
    mockDetectAvailableContainerAgents.mockResolvedValueOnce(['claude', 'codex'])

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

describe('authoring log helpers', () => {
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
})

describe('authorWorkspace', () => {
  it('feeds isolated validation failures back into the next authoring attempt before syncing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bugscrub-author-loop-'))
    tempDirectories.push(cwd)

    await mkdir(join(cwd, '.bugscrub'), { recursive: true })
    await writeFile(
      join(cwd, '.bugscrub', 'bugscrub.config.yaml'),
      [
        'version: "0"',
        'project: app',
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
        '  preferred: codex',
        '  timeout: 300',
        '  maxBudgetUsd: 5'
      ].join('\n'),
      'utf8'
    )
    await writeFile(join(cwd, 'package.json'), '{ "name": "app" }\n', 'utf8')

    mockDetectAvailableContainerAgents.mockResolvedValueOnce(['codex'])
    mockEnsureDockerRuntime.mockResolvedValueOnce()
    mockCreateDisposableWorkspace.mockResolvedValue({
      cleanup: async () => {},
      hostEnv: {
        PATH: '/tmp/bin'
      },
      sessionRoot: '/tmp/bugscrub-container-test',
      tempWorkspaceRoot: cwd
    })

    let authoringAttempt = 0
    const authorPrompts: string[] = []

    mockRunCommand.mockImplementation(async ({ args, command, cwd: commandCwd }) => {
      if (command === 'bugscrub' && args[0] === 'validate') {
        const workflowSource = await readFile(
          join(commandCwd!, '.bugscrub', 'workflows', 'settings-exploration.yaml'),
          'utf8'
        )
        const isValid = workflowSource.includes('capability: open_settings')

        return {
          exitCode: isValid ? 0 : 1,
          stderr: '',
          stdout: isValid
            ? 'bugscrub Validation passed.\n'
            : 'Validation failed with 1 issue:\n- settings-exploration.yaml: exploration.tasks[0] references missing capability "missing_capability" on surface "settings".\n'
        }
      }

      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    })
    mockRunAgentInContainer.mockImplementation(async ({ prompt: authorPrompt }) => {
      authoringAttempt += 1
      authorPrompts.push(authorPrompt)

      await Promise.all([
        mkdir(join(cwd, '.bugscrub', 'surfaces', 'settings'), {
          recursive: true
        }),
        mkdir(join(cwd, '.bugscrub', 'workflows'), {
          recursive: true
        })
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
            `    - capability: ${authoringAttempt === 1 ? 'missing_capability' : 'open_settings'}`,
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

      return {
        exitCode: 0,
        stderr: '',
        stdout: `authored attempt ${authoringAttempt}\n`
      }
    })

    const result = await authorWorkspace({
      config: {
        version: '0',
        project: 'app',
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
      },
      cwd,
      prompt: 'Create repo-specific surfaces and workflows.'
    })

    expect(authorPrompts).toHaveLength(2)
    expect(authorPrompts[1]).toContain('# Validation feedback')
    expect(authorPrompts[1]).toContain('missing_capability')
    expect(authorPrompts[1]).toContain('Use `bugscrub schema <type>`')
    expect(result.stdout).toContain('Validation failed with 1 issue')
    expect(await readFile(join(cwd, '.bugscrub', 'workflows', 'settings-exploration.yaml'), 'utf8')).toContain(
      'capability: open_settings'
    )
  })
})
