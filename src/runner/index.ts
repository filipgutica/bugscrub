import { resolve } from 'node:path'

import {
  createDisposableWorkspace,
  prepareLocalRuntimeInContainer,
  remapPath,
  startContainerSession,
  stopContainerSession,
  syncBugscrubWorkspace
} from '../agent-runtime/container.js'
import { loadBugScrubConfig } from '../core/config.js'
import { loadWorkspaceFiles } from '../core/loader.js'
import { resolveWorkspaceDefinition, validateWorkspaceDefinition } from '../core/resolver.js'
import { codexRunResultJsonSchema } from '../schemas/run-result.schema.js'
import { nowIso } from '../utils/date.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { createRunId } from '../utils/run-id.js'
import { writeRunReports } from '../reporter/index.js'
import { repairAssertionCoverage } from './assertions.js'
import { ClaudeAdapter } from './agent/claude.js'
import { CodexAdapter } from './agent/codex.js'
import { detectAndSelectAdapter } from './agent/detector.js'
import { InvalidRunResultError } from './agent/result.js'
import { MAX_OUTPUT_REPAIR_ATTEMPTS } from './agent/repair.js'
import type { AdapterRunOutput, AgentAdapter } from './agent/types.js'
import {
  buildRunContext,
  renderRunDryRunOutput,
  resolveWorkflowSelection,
  selectAdapterForDryRun
} from './context.js'
import {
  buildRunArtifactPaths,
  prepareRunArtifactDirectories,
  writePromptArtifact,
  writeResponseSchemaArtifact,
  writeTranscriptArtifact
} from './diagnostics.js'
import { isLocalBaseUrl } from './local-runtime.js'
import { negotiateCapabilities } from './negotiator.js'
import { repairInvalidAdapterOutput } from './output-repair.js'
import { toHostResult } from './result-mapping.js'

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
          includeNodeModules: !selectedAdapter.selected.requiresContainer,
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
      dryRunOutput: renderRunDryRunOutput({
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
  let containerSessionName: string | undefined

  try {
    await prepareRunArtifactDirectories({
      artifacts: context.artifacts
    })

    if (liveWorkspace && selectedAdapter.selected.requiresContainer) {
      logger.info('Starting the shared BugScrub session container.')
      containerSessionName = await startContainerSession({
        agent: selectedAdapter.selected.name,
        sessionRoot: liveWorkspace.sessionRoot,
        workdir: context.cwd
      })
    }

    const liveContext = containerSessionName
      ? {
          ...context,
          containerSessionName
        }
      : context

    if (
      liveContext.containerSessionName &&
      isLocalBaseUrl({
        baseUrl: liveContext.environment.baseUrl
      }) &&
      liveContext.environment.localRuntime
    ) {
      logger.info(
        `Preparing the configured local runtime and waiting for ${liveContext.environment.baseUrl}.`
      )
      await prepareLocalRuntimeInContainer({
        agent: selectedAdapter.selected.name,
        baseUrl: liveContext.environment.baseUrl,
        containerName: liveContext.containerSessionName,
        installCommand: liveContext.environment.localRuntime.installCommand,
        readyPath: liveContext.environment.localRuntime.readyPath,
        readyTimeoutMs: liveContext.environment.localRuntime.readyTimeoutMs,
        serverLogPath: `${liveContext.artifacts.debugDir}/local-runtime/server.log`,
        sessionRoot: liveWorkspace?.sessionRoot,
        startCommand: liveContext.environment.localRuntime.startCommand,
        timeoutMs: liveContext.environment.localRuntime.readyTimeoutMs,
        workdir: resolve(liveContext.cwd, liveContext.environment.localRuntime.cwd)
      })
    }

    await Promise.all([
      writePromptArtifact({
        path: liveContext.artifacts.promptPath,
        prompt: liveContext.prompt
      }),
      writeResponseSchemaArtifact({
        path: liveContext.artifacts.responseSchemaPath,
        schema: JSON.stringify(codexRunResultJsonSchema, null, 2)
      })
    ])

    logger.info(`Launching ${selectedAdapter.selected.name} for workflow ${liveContext.workflow.name}.`)
    const startedAt = nowIso()
    let repairAttemptsUsed = 0
    let adapterOutput: AdapterRunOutput

    try {
      adapterOutput = await selectedAdapter.selected.run(liveContext)
    } catch (error) {
      if (!(error instanceof InvalidRunResultError)) {
        throw error
      }

      const repaired = await repairInvalidAdapterOutput({
        adapter: selectedAdapter.selected,
        context: liveContext,
        error,
        initialAttempt: 1
      })
      repairAttemptsUsed = repaired.attemptsUsed
      adapterOutput = repaired.output
    }

    let hostResult = toHostResult({
      context: liveContext,
      cwd,
      output: adapterOutput,
      startedAt
    })
    const assertionCoverage = repairAssertionCoverage({
      assertions: liveContext.hardAssertions,
      results: hostResult.assertionResults
    })

    if (
      assertionCoverage.validation.issues.length > 0 &&
      selectedAdapter.selected.repairOutput &&
      repairAttemptsUsed < MAX_OUTPUT_REPAIR_ATTEMPTS
    ) {
      const repaired = await repairInvalidAdapterOutput({
        adapter: selectedAdapter.selected,
        context: liveContext,
        error: new InvalidRunResultError({
          agent: selectedAdapter.selected.name,
          issues: assertionCoverage.validation.issues,
          rawOutput: adapterOutput.rawResponse
        }),
        existingOutput: adapterOutput,
        initialAttempt: repairAttemptsUsed + 1
      })
      repairAttemptsUsed = repaired.attemptsUsed
      adapterOutput = repaired.output
      hostResult = toHostResult({
        context: liveContext,
        cwd,
        output: adapterOutput,
        startedAt
      })
    }

    const repairedAssertionCoverage = repairAssertionCoverage({
      assertions: liveContext.hardAssertions,
      results: hostResult.assertionResults
    })

    if (repairedAssertionCoverage.validation.issues.length > 0) {
      logger.warn(
        [
          'Agent returned an incomplete assertionResults payload after repair attempts. BugScrub repaired the final report instead of failing the run.',
          ...repairedAssertionCoverage.validation.issues.map((issue) => `- ${issue}`)
        ].join('\n')
      )
    }

    hostResult.assertionResults = repairedAssertionCoverage.results
    hostResult.findings = [...hostResult.findings, ...repairedAssertionCoverage.findings]

    await writeTranscriptArtifact({
      path: liveContext.artifacts.transcriptPath,
      transcript: adapterOutput.artifacts.stdout
    })

    await syncBugscrubWorkspace({
      cwd,
      tempWorkspaceRoot: liveContext.cwd
    })

    await writeRunReports({
      agent: selectedAdapter.selected.name,
      paths: {
        reportJsonPath: hostArtifacts.reportJsonPath,
        reportMarkdownPath: hostArtifacts.reportMarkdownPath
      },
      result: hostResult,
      runId: liveContext.runId,
      workflow: {
        env: liveContext.environment.name,
        name: liveContext.workflow.name,
        path: liveContext.workflowPath,
        surface: liveContext.selectedSurface.surface.name
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
    if (containerSessionName) {
      await stopContainerSession({
        containerName: containerSessionName
      })
    }
    await liveWorkspace?.cleanup()
  }
}
