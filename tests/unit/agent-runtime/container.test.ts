import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  containerInternals,
  createDisposableWorkspace
} from '../../../src/agent-runtime/container.js'

const tempDirectories: string[] = []
const originalOpenAiApiKey = process.env.OPENAI_API_KEY

describe('createDisposableWorkspace', () => {
  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true })
      )
    )
  })

  it('creates the disposable workspace next to the repo instead of under OS tmp', async () => {
    const parentRoot = await mkdtemp(join(tmpdir(), 'bugscrub-container-parent-'))
    const cwd = join(parentRoot, 'workspace')
    tempDirectories.push(parentRoot)

    await mkdir(cwd, { recursive: true })
    await mkdir(join(cwd, '.bugscrub'), { recursive: true })
    await mkdir(join(cwd, 'src'), { recursive: true })
    await Promise.all([
      writeFile(join(cwd, '.bugscrub', 'bugscrub.config.yaml'), 'version: "0"\n', 'utf8'),
      writeFile(join(cwd, 'src', 'App.tsx'), 'export const App = () => null\n', 'utf8')
    ])

    const disposable = await createDisposableWorkspace({
      agent: 'codex',
      cwd,
      includeNodeModules: false,
      includePackagedBugscrubCli: false
    })
    tempDirectories.push(disposable.sessionRoot)

    expect(dirname(disposable.sessionRoot)).toBe(parentRoot)
    expect(await readFile(join(disposable.tempWorkspaceRoot, 'src', 'App.tsx'), 'utf8')).toBe(
      'export const App = () => null\n'
    )

    await disposable.cleanup()
  })

  it('copies CLI-login auth into a writable agent home when env auth is absent', async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), 'bugscrub-home-'))
    const agentHome = await mkdtemp(join(tmpdir(), 'bugscrub-agent-home-'))
    tempDirectories.push(homeRoot, agentHome)

    await mkdir(join(homeRoot, '.codex'), { recursive: true })
    await writeFile(join(homeRoot, '.codex', 'auth.json'), '{"token":"abc"}\n', 'utf8')

    const auth = await containerInternals.resolveContainerAuth({
      agent: 'codex',
      agentHomeDir: agentHome,
      baseEnv: {
        HOME: homeRoot,
        PATH: process.env.PATH
      }
    })

    expect(auth.env.OPENAI_API_KEY).toBeUndefined()
    expect(await readFile(join(agentHome, '.codex', 'auth.json'), 'utf8')).toBe('{"token":"abc"}\n')
  })

  it('does not treat CODEX_HOME alone as env-based auth', async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), 'bugscrub-home-'))
    const tempCodexHome = await mkdtemp(join(tmpdir(), 'bugscrub-codex-home-'))
    const agentHome = await mkdtemp(join(tmpdir(), 'bugscrub-agent-home-'))
    tempDirectories.push(homeRoot, tempCodexHome, agentHome)

    await mkdir(join(tempCodexHome, '.codex'), { recursive: true })
    await writeFile(join(tempCodexHome, '.codex', 'auth.json'), '{"token":"abc"}\n', 'utf8')

    await containerInternals.resolveContainerAuth({
      agent: 'codex',
      agentHomeDir: agentHome,
      baseEnv: {
        CODEX_HOME: join(tempCodexHome, '.codex'),
        HOME: homeRoot,
        PATH: process.env.PATH
      }
    })

    expect(await readFile(join(agentHome, '.codex', 'auth.json'), 'utf8')).toBe('{"token":"abc"}\n')
  })

  it('creates the codex home directory even before auth is staged', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'bugscrub-session-'))
    const cwd = await mkdtemp(join(tmpdir(), 'bugscrub-workdir-'))
    tempDirectories.push(sessionRoot, cwd)
    process.env.OPENAI_API_KEY = 'test-key'

    await containerInternals.createDockerArgs({
      agent: 'codex',
      containerArgs: ['codex', '--version'],
      sessionRoot,
      timeoutMs: 1_000,
      workdir: cwd
    })

    await access(join(sessionRoot, 'agent-home', '.codex'))
  })

  it('preserves the working-directory flag when building detached session args', () => {
    const args = containerInternals.buildDetachedSessionArgs({
      containerName: 'bugscrub-codex-session',
      runArgs: [
        'run',
        '--rm',
        '--init',
        '-w',
        '/Users/Test/Workspace',
        '-e',
        'HOME=/tmp/home',
        'bugscrub-agent:latest',
        'sh',
        '-lc',
        'sleep 1'
      ]
    })

    expect(args).toEqual([
      'run',
      '-d',
      '--name',
      'bugscrub-codex-session',
      '--rm',
      '--init',
      '-w',
      '/Users/Test/Workspace',
      '-e',
      'HOME=/tmp/home',
      'bugscrub-agent:latest',
      'sh',
      '-lc',
      'sleep 1'
    ])
  })

  it('treats codex chrome-devtools config backed by npx as needing reconfiguration', () => {
    expect(
      containerInternals.isChromeDevtoolsMcpConfigured({
        agent: 'codex',
        output: [
          'chrome-devtools',
          '  enabled: true',
          '  transport: stdio',
          '  command: npx',
          '  args: chrome-devtools-mcp@latest',
          '  cwd: -',
          '  env: -'
        ].join('\n')
      })
    ).toBe(false)
  })

  it('accepts codex chrome-devtools config backed by the image-local binary', () => {
    expect(
      containerInternals.isChromeDevtoolsMcpConfigured({
        agent: 'codex',
        output: [
          'chrome-devtools',
          '  enabled: true',
          '  transport: stdio',
          '  command: chrome-devtools-mcp',
          '  args: -',
          '  cwd: -',
          '  env: -'
        ].join('\n')
      })
    ).toBe(true)
  })

  it('treats claude chrome-devtools config backed by npx as needing reconfiguration', () => {
    expect(
      containerInternals.isChromeDevtoolsMcpConfigured({
        agent: 'claude',
        output: [
          'chrome-devtools',
          '  enabled: true',
          '  transport: stdio',
          '  command: npx',
          '  args: chrome-devtools-mcp@latest',
          '  cwd: -',
          '  env: -'
        ].join('\n')
      })
    ).toBe(false)
  })

  it('accepts claude chrome-devtools config backed by the image-local binary', () => {
    expect(
      containerInternals.isChromeDevtoolsMcpConfigured({
        agent: 'claude',
        output: [
          'chrome-devtools',
          '  enabled: true',
          '  transport: stdio',
          '  command: chrome-devtools-mcp',
          '  args: -',
          '  cwd: -',
          '  env: -'
        ].join('\n')
      })
    ).toBe(true)
  })

  it('builds a browser preflight script that targets the image-local Chrome wrapper', () => {
    const script = containerInternals.buildChromeDevtoolsBrowserPreflightScript({
      logPath: '/tmp/chrome-devtools-preflight.log'
    })

    expect(script).toContain('/opt/google/chrome/chrome')
    expect(script).toContain('chrome-devtools-mcp')
    expect(script).toContain('http://127.0.0.1:9222/json/version')
  })
})
