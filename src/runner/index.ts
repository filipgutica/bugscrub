import { resolve } from 'node:path'

import { createDisposableWorkspace, remapPath, syncBugscrubWorkspace } from '../agent-runtime/container.js'
import { loadBugScrubConfig } from '../core/config.js'
import { loadWorkspaceFiles } from '../core/loader.js'
import { resolveWorkspaceDefinition, validateWorkspaceDefinition } from '../core/resolver.js'
import { getJsonSchemaByType } from '../schemas/index.js'
import { codexRunResultJsonSchema } from '../schemas/run-result.schema.js'
import type { AssertionConfig, CapabilityConfig, SignalConfig, WorkflowConfig } from '../types/index.js'
import { nowIso } from '../utils/date.js'
import { CliError, ValidationError } from '../utils/errors.js'
import { createRunId } from '../utils/run-id.js'
import { writeRunReports } from '../reporter/index.js'
import { validateAssertionCoverage } from './assertions.js'
import { ClaudeAdapter } from './agent/claude.js'
import { CodexAdapter } from './agent/codex.js'
import { detectAndSelectAdapter } from './agent/detector.js'
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
import {
  buildRunArtifactPaths,
  prepareRunArtifactDirectories,
  writePromptArtifact,
  writeResponseSchemaArtifact,
  writeTranscriptArtifact
} from './diagnostics.js'
import { negotiateCapabilities } from './negotiator.js'
import { buildPromptForContext } from './prompt/builder.js'
import type { ResolvedSurface } from '../core/resolver.js'

// Runner is the only place where validated repo definitions become an
// executable agent request. Everything above this layer should stay agent-
// agnostic; everything below it should consume a fully prepared RunContext.
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

const resolveWorkflowSelection = ({
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

const buildRunContext = ({
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
  // Materialize all identities up front so the prompt builder and adapters get
  // a stable snapshot of the selected environment.
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
      baseUrl: environment.baseUrl,
      defaultIdentity,
      identities,
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

const renderDryRunOutput = ({
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

const selectAdapterForDryRun = ({
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

export const createDefaultAdapters = (): AgentAdapter[] => {
  return [new ClaudeAdapter(), new CodexAdapter()]
}

export const executeRun = async ({
  adapters = createDefaultAdapters(),
  cwd,
  dryRun,
  maxSteps,
  workflow
}: {
  adapters?: AgentAdapter[]
  cwd: string
  dryRun: boolean
  maxSteps: number | undefined
  workflow: string | undefined
}): Promise<{
  dryRunOutput?: string
  reportPaths?: {
    json: string
    markdown: string
  }
}> => {
  const config = await loadBugScrubConfig({ cwd })
  const workspace = await loadWorkspaceFiles({ cwd })
  const validation = validateWorkspaceDefinition({
    config,
    surfaces: workspace.surfaces,
    workflows: workspace.workflows
  })

  if (validation.issues.length > 0) {
    throw new CliError({
      message: [
        `Validation failed with ${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}:`,
        ...validation.issues.map(({ message, path }) => `- ${path}: ${message}`)
      ].join('\n'),
      exitCode: 1
    })
  }

  const selectedWorkflow = resolveWorkflowSelection({
    cwd,
    workflow,
    workflows: workspace.workflows
  })
  const surfaces = resolveWorkspaceDefinition({
    surfaces: workspace.surfaces
  })
  const surface = surfaces.get(selectedWorkflow.workflow.target.surface)

  if (!surface) {
    throw new CliError({
      message: `Surface "${selectedWorkflow.workflow.target.surface}" could not be resolved.`,
      exitCode: 1
    })
  }

  const selectedAdapter = dryRun
    ? selectAdapterForDryRun({
        adapters,
        config
      })
    : await detectAndSelectAdapter({
        adapters,
        config
      })
  const capabilities = await selectedAdapter.selected.getCapabilities()
  negotiateCapabilities({
    capabilities,
    requires: selectedWorkflow.workflow.requires
  })

  const runId = createRunId()
  const liveWorkspace =
    dryRun
      ? undefined
      : await createDisposableWorkspace({
          agent: selectedAdapter.selected.name,
          cwd,
          includeNodeModules: true,
          includePackagedBugscrubCli: false
        })
  const context = buildRunContext({
    adapter: selectedAdapter.selected,
    capabilities,
    ...(liveWorkspace
      ? {
          containerSessionRoot: liveWorkspace.sessionRoot
        }
      : {}),
    config,
    cwd: liveWorkspace?.tempWorkspaceRoot ?? cwd,
    maxSteps,
    runId,
    selectedWorkflow,
    surface
  })

  if (dryRun) {
    return {
      dryRunOutput: renderDryRunOutput({
        availableAdapters: selectedAdapter.available,
        context
      })
    }
  }

  const hostArtifacts = buildRunArtifactPaths({
    cwd,
    runId,
    workflowName: selectedWorkflow.workflow.name
  })

  try {
    await prepareRunArtifactDirectories({
      artifacts: context.artifacts
    })

    await Promise.all([
      writePromptArtifact({
        path: context.artifacts.promptPath,
        prompt: context.prompt
      }),
      writeResponseSchemaArtifact({
        path: context.artifacts.responseSchemaPath,
        schema: JSON.stringify(codexRunResultJsonSchema, null, 2)
      })
    ])

    const startedAt = nowIso()
    const adapterOutput = await selectedAdapter.selected.run(context)
    await writeTranscriptArtifact({
      path: context.artifacts.transcriptPath,
      transcript: adapterOutput.artifacts.stdout
    })

    const result = {
      ...adapterOutput.result,
      startedAt: adapterOutput.result.startedAt || startedAt,
      transcriptPath: remapPath({
        fromRoot: context.cwd,
        path: context.artifacts.transcriptPath,
        toRoot: cwd
      })
    }
    const remapResultPath = (path: string | undefined) =>
      path === undefined
        ? undefined
        : remapPath({
            fromRoot: context.cwd,
            path,
            toRoot: cwd
          })
    const hostResult = {
      ...result,
      assertionResults: result.assertionResults.map((assertionResult) => ({
        ...assertionResult,
        ...(assertionResult.evidence
          ? {
              evidence: {
                networkLog: remapResultPath(assertionResult.evidence.networkLog),
                screenshot: remapResultPath(assertionResult.evidence.screenshot)
              }
            }
          : {})
      })),
      evidence: {
        networkLogs: result.evidence.networkLogs.map((path) =>
          remapPath({
            fromRoot: context.cwd,
            path,
            toRoot: cwd
          })
        ),
        screenshots: result.evidence.screenshots.map((path) =>
          remapPath({
            fromRoot: context.cwd,
            path,
            toRoot: cwd
          })
        )
      },
      findings: result.findings.map((finding) => ({
        ...finding,
        ...(finding.evidence
          ? {
              evidence: {
                networkLog: remapResultPath(finding.evidence.networkLog),
                screenshot: remapResultPath(finding.evidence.screenshot)
              }
            }
          : {})
      }))
    }
    const assertionValidation = validateAssertionCoverage({
      assertions: context.hardAssertions,
      results: hostResult.assertionResults
    })

    if (assertionValidation.issues.length > 0) {
      throw new CliError({
        message: [
          'Agent returned an incomplete assertionResults payload.',
          ...assertionValidation.issues.map((issue) => `- ${issue}`)
        ].join('\n'),
        exitCode: 1
      })
    }

    await syncBugscrubWorkspace({
      cwd,
      tempWorkspaceRoot: context.cwd
    })

    await writeRunReports({
      agent: selectedAdapter.selected.name,
      paths: {
        reportJsonPath: hostArtifacts.reportJsonPath,
        reportMarkdownPath: hostArtifacts.reportMarkdownPath
      },
      result: hostResult,
      runId: context.runId,
      workflow: {
        env: context.environment.name,
        name: context.workflow.name,
        path: context.workflowPath,
        surface: context.selectedSurface.surface.name
      }
    })

    return {
      reportPaths: {
        json: hostArtifacts.reportJsonPath,
        markdown: hostArtifacts.reportMarkdownPath
      }
    }
  } catch (error) {
    await syncBugscrubWorkspace({
      cwd,
      tempWorkspaceRoot: context.cwd
    })

    throw error
  } finally {
    await liveWorkspace?.cleanup()
  }
}
