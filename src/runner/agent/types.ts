import type {
  AssertionConfig,
  AssertionResult,
  AuthConfig,
  BugScrubConfig,
  CapabilityConfig,
  RunResult,
  SignalConfig,
  WorkflowConfig
} from '../../types/index.js'
import type { ResolvedSurface } from '../../core/resolver.js'

// AgentAdapter types define the stable contract between BugScrub and external runtimes.
export type AgentName = 'claude' | 'codex'

export type AgentCapabilities = {
  browser: {
    navigation: boolean
    domRead: boolean
    networkObserve: boolean
    screenshots: boolean
  }
  api: {
    httpRequests: boolean
  }
  auth: {
    session: boolean
    token: boolean
  }
}

export type ResolvedIdentity = {
  auth: AuthConfig
  name: string
}

export type ResolvedSignal = SignalConfig & {
  namespacedName: string
}

export type ResolvedCapability = CapabilityConfig & {
  failureSignals: ResolvedSignal[]
  namespacedName: string
  successSignals: ResolvedSignal[]
}

export type ResolvedAssertion = AssertionConfig & {
  namespacedName: string
}

export type ResolvedSetupStep = {
  capability: ResolvedCapability
  identity: ResolvedIdentity
}

export type ResolvedTaskStep = {
  capability: ResolvedCapability
  identity: ResolvedIdentity
  max: number
  min: number
}

export type RunArtifactPaths = {
  debugDir: string
  networkDir: string
  promptPath: string
  reportJsonPath: string
  reportMarkdownPath: string
  responseSchemaPath: string
  screenshotsDir: string
  transcriptPath: string
}

export type BaseRunContext = {
  agent: {
    capabilities: AgentCapabilities
    name: AgentName
  }
  artifacts: RunArtifactPaths
  config: BugScrubConfig
  cwd: string
  environment: {
    baseUrl: string
    defaultIdentity: ResolvedIdentity
    identities: ResolvedIdentity[]
    name: string
  }
  hardAssertions: ResolvedAssertion[]
  maxBudgetUsd: number
  maxSteps: number | undefined
  runId: string
  selectedSurface: ResolvedSurface
  setup: ResolvedSetupStep[]
  tasks: ResolvedTaskStep[]
  timeoutSeconds: number
  workflow: WorkflowConfig
  workflowPath: string
}

export type RunContext = BaseRunContext & {
  prompt: string
}

export type AdapterRunArtifacts = {
  raw: Record<string, unknown> | undefined
  stdout: string
  stderr: string
}

export type AdapterRunOutput = {
  artifacts: AdapterRunArtifacts
  result: RunResult
}

export interface AgentAdapter {
  detect(): Promise<boolean>
  getCapabilities(): Promise<AgentCapabilities>
  readonly name: AgentName
  run(context: RunContext): Promise<AdapterRunOutput>
}

export type AssertionValidationResult = {
  issues: string[]
}

export type RunReport = {
  agent: AgentName
  generatedAt: string
  result: RunResult
  runId: string
  workflow: {
    env: string
    name: string
    path: string
    surface: string
  }
}
