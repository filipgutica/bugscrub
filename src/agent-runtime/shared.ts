import type { BugScrubConfig } from '../types/index.js'

export type ContainerAgent = 'claude' | 'codex'

export type WorkspaceConfig = BugScrubConfig & {
  agent: BugScrubConfig['agent'] & {
    preferred: ContainerAgent
  }
}

export type ContainerAuth = {
  env: NodeJS.ProcessEnv
}

export type DisposableWorkspace = {
  cleanup: () => Promise<void>
  hostEnv: NodeJS.ProcessEnv
  sessionRoot: string
  tempWorkspaceRoot: string
}

export type ContainerExecutionTarget = {
  agent: ContainerAgent
  containerName: string | undefined
  sessionRoot: string | undefined
  timeoutMs: number
  workdir: string
}

export const BUGSCRUB_CONTAINER_IMAGE = process.env.BUGSCRUB_CONTAINER_IMAGE ?? 'bugscrub-agent:latest'

export const STRIPPED_ENV_VARS = [
  'NODE_INSPECT_RESUME_ON_START',
  'NODE_OPTIONS',
  'VSCODE_INSPECTOR_OPTIONS'
] as const

export const BASE_ALLOWED_ENV_KEYS = new Set([
  'APPDATA',
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'LOGNAME',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME'
])

export const AUTH_ENV_PREFIXES: Record<ContainerAgent, string[]> = {
  claude: ['ANTHROPIC_', 'CLAUDE_CODE_'],
  codex: ['CODEX_', 'OPENAI_']
}

export const AUTH_ENV_KEYS: Record<ContainerAgent, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'OPENAI_ACCESS_TOKEN']
}

export const EXCLUDED_SOURCE_NAMES = new Set([
  '.aws',
  '.env',
  '.git',
  '.gnupg',
  '.npmrc',
  '.pnpmrc',
  '.ssh',
  '.terraform',
  '.yarnrc',
  '.yarnrc.yml',
  'id_ed25519',
  'id_rsa'
])

export const EXCLUDED_SOURCE_PATTERNS = [
  /^\.env\./i,
  /^service-account.*\.json$/i,
  /\.(?:cer|crt|der|key|kdbx|p12|pem|pfx)$/i
] as const

export const AUTH_SOURCE_RELATIVE_PATHS: Record<ContainerAgent, string[]> = {
  claude: ['.claude', '.config/claude', '.config/claude-code'],
  codex: ['.codex', '.config/codex', '.config/openai']
}

export const AGENT_HOME_RELATIVE_PATHS: Record<ContainerAgent, string[]> = {
  claude: ['.claude', '.config/claude-code'],
  codex: ['.codex']
}

export const DEFAULT_AUTHORING_CLAUDE_MODEL = 'sonnet'
export const DEFAULT_AUTHORING_CODEX_MODEL = 'gpt-5.3-codex'
export const DEFAULT_SESSION_CONTAINER_COMMAND = [
  'sh',
  '-lc',
  'trap "exit 0" TERM INT; while :; do sleep 3600; done'
] as const
export const CHROME_DEVTOOLS_MCP_COMMAND = 'chrome-devtools-mcp'
export const CONTAINER_CHROME_WRAPPER_PATH = '/opt/google/chrome/chrome'

export const LOCAL_RUNTIME_ENV_PREFIX = [
  'CI=true',
  'COREPACK_ENABLE_DOWNLOAD_PROMPT=0'
].join(' ')

export const shellQuote = (value: string): string => {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

export const createSanitizedHostEnv = ({
  baseEnv = process.env
}: {
  baseEnv?: NodeJS.ProcessEnv
} = {}): NodeJS.ProcessEnv => {
  const env = {
    ...baseEnv
  }

  for (const key of STRIPPED_ENV_VARS) {
    delete env[key]
  }

  return env
}
