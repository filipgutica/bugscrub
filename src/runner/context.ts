import { resolve } from 'node:path'

import { loadBugScrubConfig } from '../core/config.js'
import type { ResolvedSurface } from '../core/resolver.js'
import type { AssertionConfig, CapabilityConfig, SignalConfig, WorkflowConfig } from '../types/index.js'
import { CliError, ValidationError } from '../utils/errors.js'
import type {
  AgentAdapter,
  AgentName,
  BaseRunContext,
  ResolvedAssertion,
  ResolvedCapability,
  ResolvedIdentity,
  ResolvedSignal,
  RunContext
} from './agent/types.js'
import { buildRunArtifactPaths } from './diagnostics.js'
import { isLocalBaseUrl, normalizeContainerRuntimeBaseUrl } from './local-runtime.js'
import { buildPromptForContext } from './prompt/builder.js'

const resolveIdentity = ({
  environment,
  identityName
}: {
  environment: Record<string, { auth: ResolvedIdentity['auth'] }>
  identityName: string
}): ResolvedIdentity => {
  const auth = environment[identityName]

  if (!auth) {
    throw new ValidationError({
      message: `Identity "${identityName}" could not be resolved.`,
      details: []
    })
  }

  return {
    auth: auth.auth,
    name: identityName
  }
}

const resolveSignal = ({
  signal,
  surfaceName
}: {
  signal: SignalConfig
  surfaceName: string
}): ResolvedSignal => {
  return {
    ...signal,
    namespacedName: `${surfaceName}.${signal.name}`
  }
}

const resolveCapability = ({
  capability,
  surface,
  surfaceName
}: {
  capability: CapabilityConfig
  surface: ResolvedSurface
  surfaceName: string
}): ResolvedCapability => {
  const successSignals = capability.success_signals
    .map((signalName) => surface.signalMap.get(signalName))
    .filter((signal): signal is SignalConfig => signal !== undefined)
    .map((signal) =>
      resolveSignal({
        signal,
        surfaceName
      })
    )
  const failureSignals = capability.failure_signals
    .map((signalName) => surface.signalMap.get(signalName))
    .filter((signal): signal is SignalConfig => signal !== undefined)
    .map((signal) =>
      resolveSignal({
        signal,
        surfaceName
      })
    )

  return {
    ...capability,
    failureSignals,
    namespacedName: `${surfaceName}.${capability.name}`,
    successSignals
  }
}

const resolveAssertion = ({
  assertion,
  surfaceName
}: {
  assertion: AssertionConfig
  surfaceName: string
}): ResolvedAssertion => {
  return {
    ...assertion,
    namespacedName: `${surfaceName}.${assertion.name}`
  }
}

export const resolveWorkflowSelection = ({
  workflow,
  workflows,
  cwd
}: {
  cwd: string
  workflow: string | undefined
  workflows: Array<{ path: string; workflow: WorkflowConfig }>
}) => {
  if (workflow) {
    const expectedPath = resolve(cwd, workflow)
    const byPath = workflows.find((candidate) => resolve(candidate.path) === expectedPath)

    if (byPath) {
      return byPath
    }

    const byName = workflows.find((candidate) => candidate.workflow.name === workflow)

    if (byName) {
      return byName
    }

    throw new CliError({
      message: `Workflow "${workflow}" could not be found.`,
      exitCode: 2
    })
  }

  if (workflows.length !== 1) {
    throw new CliError({
      message: 'Multiple workflows are available. Re-run with `--workflow <path-or-name>`.',
      exitCode: 2
    })
  }

  return workflows[0]!
}

export const buildRunContext = ({
  adapter,
  capabilities,
  containerSessionRoot,
  config,
  cwd,
  maxSteps,
  runId,
  selectedWorkflow,
  surface
}: {
  adapter: AgentAdapter
  capabilities: Awaited<ReturnType<AgentAdapter['getCapabilities']>>
  containerSessionRoot?: string
  config: Awaited<ReturnType<typeof loadBugScrubConfig>>
  cwd: string
  maxSteps: number | undefined
  runId: string
  selectedWorkflow: { path: string; workflow: WorkflowConfig }
  surface: ResolvedSurface
}): RunContext => {
  const environment = config.envs[selectedWorkflow.workflow.target.env]

  if (!environment) {
    throw new CliError({
      message: `Environment "${selectedWorkflow.workflow.target.env}" does not exist.`,
      exitCode: 1
    })
  }

  const artifacts = buildRunArtifactPaths({
    cwd,
    runId,
    workflowName: selectedWorkflow.workflow.name
  })
  const identities = Object.keys(environment.identities).map((identityName) =>
    resolveIdentity({
      environment: environment.identities,
      identityName
    })
  )
  const defaultIdentity = resolveIdentity({
    environment: environment.identities,
    identityName: environment.defaultIdentity
  })
  const getIdentityForStep = (identityName: string | undefined) =>
    resolveIdentity({
      environment: environment.identities,
      identityName: identityName ?? environment.defaultIdentity
    })

  const context: BaseRunContext = {
    agent: {
      capabilities,
      name: adapter.name
    },
    artifacts,
    ...(containerSessionRoot
      ? {
          containerSessionRoot
        }
      : {}),
    config,
    cwd,
    environment: {
      baseUrl:
        environment.localRuntime && isLocalBaseUrl({ baseUrl: environment.baseUrl })
          ? normalizeContainerRuntimeBaseUrl({
              baseUrl: environment.baseUrl
            })
          : environment.baseUrl,
      defaultIdentity,
      identities,
      ...(environment.localRuntime
        ? {
            localRuntime: environment.localRuntime
          }
        : {}),
      name: selectedWorkflow.workflow.target.env
    },
    hardAssertions: selectedWorkflow.workflow.hard_assertions.map((assertionName) => {
      const assertion = surface.assertionMap.get(assertionName)

      if (!assertion) {
        throw new CliError({
          message: `Workflow references missing assertion "${assertionName}".`,
          exitCode: 1
        })
      }

      return resolveAssertion({
        assertion,
        surfaceName: surface.surface.name
      })
    }),
    maxBudgetUsd: config.agent.maxBudgetUsd,
    maxSteps: maxSteps ?? config.agent.maxSteps,
    runId,
    selectedSurface: surface,
    setup: selectedWorkflow.workflow.setup.map((step) => {
      const capability = surface.capabilityMap.get(step.capability)

      if (!capability) {
        throw new CliError({
          message: `Workflow references missing setup capability "${step.capability}".`,
          exitCode: 1
        })
      }

      return {
        capability: resolveCapability({
          capability,
          surface,
          surfaceName: surface.surface.name
        }),
        identity: getIdentityForStep(step.as)
      }
    }),
    tasks: selectedWorkflow.workflow.exploration.tasks.map((task) => {
      const capability = surface.capabilityMap.get(task.capability)

      if (!capability) {
        throw new CliError({
          message: `Workflow references missing task capability "${task.capability}".`,
          exitCode: 1
        })
      }

      return {
        capability: resolveCapability({
          capability,
          surface,
          surfaceName: surface.surface.name
        }),
        identity: getIdentityForStep(task.as),
        max: task.max,
        min: task.min
      }
    }),
    timeoutSeconds: config.agent.timeout,
    workflow: selectedWorkflow.workflow,
    workflowPath: selectedWorkflow.path
  }

  return {
    ...context,
    prompt: buildPromptForContext({
      context
    })
  }
}

export const renderRunDryRunOutput = ({
  availableAdapters,
  context
}: {
  availableAdapters: AgentAdapter[]
  context: RunContext
}): string => {
  return [
    `BugScrub run dry-run for workflow \`${context.workflow.name}\``,
    `Selected adapter: ${context.agent.name}`,
    `Detected adapters: ${availableAdapters.map((adapter) => adapter.name).join(', ') || 'none'}`,
    `Target: ${context.environment.baseUrl} (${context.selectedSurface.surface.name})`,
    `Workflow path: ${context.workflowPath}`,
    `Workflow requirements: ${context.workflow.requires.join(', ') || 'none'}`,
    `Run ID: ${context.runId}`,
    '',
    'Prompt preview:',
    context.prompt
  ].join('\n')
}

export const selectAdapterForDryRun = ({
  adapters,
  config
}: {
  adapters: AgentAdapter[]
  config: Awaited<ReturnType<typeof loadBugScrubConfig>>
}): {
  available: AgentAdapter[]
  selected: AgentAdapter
} => {
  const preferredOrder: AgentName[] =
    config.agent.preferred === 'auto' ? ['claude', 'codex'] : [config.agent.preferred]
  const selected = preferredOrder
    .map((name) => adapters.find((adapter) => adapter.name === name))
    .find((adapter): adapter is AgentAdapter => adapter !== undefined)

  if (!selected) {
    const registered = adapters.length > 0 ? adapters.map((adapter) => adapter.name).join(', ') : 'none'

    throw new CliError({
      message: [
        `No supported adapter implementation is registered for preference "${config.agent.preferred}".`,
        `Registered adapters: ${registered}.`
      ].join('\n'),
      exitCode: 1
    })
  }

  return {
    available: adapters,
    selected
  }
}
