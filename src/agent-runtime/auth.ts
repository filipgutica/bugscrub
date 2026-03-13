import { cp, mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { CliError } from '../utils/errors.js'
import { fileExists } from '../utils/fs.js'
import { isCommandAvailable } from '../runner/agent/process.js'
import {
  AGENT_HOME_RELATIVE_PATHS,
  AUTH_ENV_KEYS,
  AUTH_ENV_PREFIXES,
  AUTH_SOURCE_RELATIVE_PATHS,
  BASE_ALLOWED_ENV_KEYS,
  type ContainerAgent,
  type ContainerAuth,
  STRIPPED_ENV_VARS
} from './shared.js'

const buildAllowedContainerEnv = ({
  agent,
  baseEnv = process.env
}: {
  agent: ContainerAgent
  baseEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(baseEnv)) {
    if (
      value !== undefined &&
      (BASE_ALLOWED_ENV_KEYS.has(key) ||
        AUTH_ENV_PREFIXES[agent].some((prefix) => key.startsWith(prefix)))
    ) {
      env[key] = value
    }
  }

  for (const key of STRIPPED_ENV_VARS) {
    delete env[key]
  }

  return env
}

const hasAgentEnvAuth = ({
  agent,
  env
}: {
  agent: ContainerAgent
  env: NodeJS.ProcessEnv
}): boolean => {
  return AUTH_ENV_KEYS[agent].some((key) => {
    const value = env[key]
    return typeof value === 'string' && value.length > 0
  })
}

const getCandidateAuthSources = ({
  agent,
  baseEnv = process.env
}: {
  agent: ContainerAgent
  baseEnv?: NodeJS.ProcessEnv
}): Array<{ source: string; targetRelativePath: string }> => {
  const home = baseEnv.HOME ?? homedir()
  const xdgConfigHome = baseEnv.XDG_CONFIG_HOME ?? join(home, '.config')
  const candidates: Array<{ source: string; targetRelativePath: string }> = []

  const explicitHome =
    agent === 'claude'
      ? baseEnv.CLAUDE_CODE_HOME
      : baseEnv.CODEX_HOME

  if (explicitHome) {
    candidates.push({
      source: resolve(explicitHome),
      targetRelativePath: AGENT_HOME_RELATIVE_PATHS[agent][0]!
    })
  }

  for (const relativePath of AUTH_SOURCE_RELATIVE_PATHS[agent]) {
    const source =
      relativePath.startsWith('.config/')
        ? resolve(xdgConfigHome, relativePath.replace(/^\.config\//, ''))
        : resolve(home, relativePath)

    candidates.push({
      source,
      targetRelativePath: relativePath
    })
  }

  return candidates
}

export const resolveContainerAuth = async ({
  agent,
  agentHomeDir,
  baseEnv = process.env
}: {
  agent: ContainerAgent
  agentHomeDir: string
  baseEnv?: NodeJS.ProcessEnv
}): Promise<ContainerAuth> => {
  const env = buildAllowedContainerEnv({
    agent,
    baseEnv
  })
  const hasEnvAuth = hasAgentEnvAuth({ agent, env })
  let stagedAuthSource = false

  if (!hasEnvAuth) {
    for (const candidate of getCandidateAuthSources({
      agent,
      baseEnv
    })) {
      if (
        await fileExists({
          path: candidate.source
        })
      ) {
        const target = join(agentHomeDir, candidate.targetRelativePath)
        await mkdir(join(target, '..'), {
          recursive: true
        })
        await rm(target, {
          force: true,
          recursive: true
        })
        await cp(candidate.source, target, {
          recursive: true
        })
        stagedAuthSource = true
      }
    }
  }

  if (!hasEnvAuth && !stagedAuthSource) {
    const authLabel =
      agent === 'codex'
        ? 'OPENAI_/CODEX env vars or a readable Codex CLI auth directory'
        : 'ANTHROPIC_/CLAUDE_CODE_ env vars or a readable Claude CLI auth directory'

    throw new CliError({
      message: [
        `No usable ${agent} authentication source is available for container execution.`,
        `Provide ${authLabel}.`
      ].join('\n'),
      exitCode: 1
    })
  }

  return {
    env
  }
}

export const detectAvailableContainerAgents = async ({
  baseEnv = process.env
}: {
  baseEnv?: NodeJS.ProcessEnv
} = {}): Promise<ContainerAgent[]> => {
  const dockerInstalled = await isCommandAvailable({
    command: 'docker'
  })

  if (!dockerInstalled) {
    return []
  }

  const available: ContainerAgent[] = []

  for (const agent of ['claude', 'codex'] as const) {
    const env = buildAllowedContainerEnv({
      agent,
      baseEnv
    })
    const authCandidates = getCandidateAuthSources({
      agent,
      baseEnv
    })
    const hasAuthMount = (
      await Promise.all(
        authCandidates.map((candidate) =>
          fileExists({
            path: candidate.source
          })
        )
      )
    ).some(Boolean)

    if (hasAgentEnvAuth({ agent, env }) || hasAuthMount) {
      available.push(agent)
    }
  }

  return available
}
