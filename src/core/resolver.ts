import { basename } from 'node:path'

import type {
  AssertionConfig,
  BugScrubConfig,
  CapabilityConfig,
  SignalConfig,
  WorkflowConfig
} from '../types/index.js'
import { ValidationError } from '../utils/errors.js'
import type { SurfaceBundle } from './loader.js'

type ValidationIssue = {
  path: string
  message: string
}

export type ResolvedSurface = SurfaceBundle & {
  capabilityMap: Map<string, CapabilityConfig>
  assertionMap: Map<string, AssertionConfig>
  signalMap: Map<string, SignalConfig>
}

export type ValidationResult = {
  issues: ValidationIssue[]
}

const pushIssue = ({
  issues,
  path,
  message
}: {
  issues: ValidationIssue[]
  path: string
  message: string
}) => {
  issues.push({ path, message })
}

export const buildResolvedSurface = ({
  bundle,
  issues
}: {
  bundle: SurfaceBundle
  issues: ValidationIssue[]
}): ResolvedSurface => {
  const capabilityMap = new Map<string, CapabilityConfig>()
  const assertionMap = new Map<string, AssertionConfig>()
  const signalMap = new Map<string, SignalConfig>()

  if (bundle.directoryName !== bundle.surface.name) {
    pushIssue({
      issues,
      path: `${bundle.directoryName}/surface.yaml`,
      message: `Surface directory name "${bundle.directoryName}" must match surface.name "${bundle.surface.name}".`
    })
  }

  for (const capability of bundle.capabilities) {
    if (capabilityMap.has(capability.name)) {
      pushIssue({
        issues,
        path: `${bundle.directoryName}/capabilities.yaml`,
        message: `Duplicate capability "${capability.name}".`
      })
      continue
    }

    capabilityMap.set(capability.name, capability)
  }

  for (const assertion of bundle.assertions) {
    if (assertionMap.has(assertion.name)) {
      pushIssue({
        issues,
        path: `${bundle.directoryName}/assertions.yaml`,
        message: `Duplicate assertion "${assertion.name}".`
      })
      continue
    }

    assertionMap.set(assertion.name, assertion)
  }

  for (const signal of bundle.signals) {
    if (signalMap.has(signal.name)) {
      pushIssue({
        issues,
        path: `${bundle.directoryName}/signals.yaml`,
        message: `Duplicate signal "${signal.name}".`
      })
      continue
    }

    signalMap.set(signal.name, signal)
  }

  for (const capabilityName of bundle.surface.capabilities) {
    if (!capabilityMap.has(capabilityName)) {
      pushIssue({
        issues,
        path: `${bundle.directoryName}/surface.yaml`,
        message: `surface.capabilities references missing capability "${capabilityName}".`
      })
    }
  }

  for (const capability of bundle.capabilities) {
    for (const signalName of capability.success_signals) {
      if (!signalMap.has(signalName)) {
        pushIssue({
          issues,
          path: `${bundle.directoryName}/capabilities.yaml`,
          message: `Capability "${capability.name}" references missing success signal "${signalName}".`
        })
      }
    }

    for (const signalName of capability.failure_signals) {
      if (!signalMap.has(signalName)) {
        pushIssue({
          issues,
          path: `${bundle.directoryName}/capabilities.yaml`,
          message: `Capability "${capability.name}" references missing failure signal "${signalName}".`
        })
      }
    }
  }

  return {
    ...bundle,
    capabilityMap,
    assertionMap,
    signalMap
  }
}

const validateWorkflow = ({
  config,
  surfaceMap,
  workflow,
  workflowPath,
  issues
}: {
  config: BugScrubConfig
  surfaceMap: Map<string, ResolvedSurface>
  workflow: WorkflowConfig
  workflowPath: string
  issues: ValidationIssue[]
}) => {
  const environment = config.envs[workflow.target.env]

  if (!environment) {
    pushIssue({
      issues,
      path: basename(workflowPath),
      message: `target.env "${workflow.target.env}" does not exist in bugscrub.config.yaml.`
    })
    return
  }

  const surface = surfaceMap.get(workflow.target.surface)

  if (!surface) {
    pushIssue({
      issues,
      path: basename(workflowPath),
      message: `target.surface "${workflow.target.surface}" does not exist.`
    })
    return
  }

  const validateIdentityRef = ({
    identity,
    field
  }: {
    identity: string | undefined
    field: string
  }) => {
    if (identity && !(identity in environment.identities)) {
      pushIssue({
        issues,
        path: basename(workflowPath),
        message: `${field} references unknown identity "${identity}" for env "${workflow.target.env}".`
      })
    }
  }

  for (const [index, step] of workflow.setup.entries()) {
    if (!surface.capabilityMap.has(step.capability)) {
      pushIssue({
        issues,
        path: basename(workflowPath),
        message: `setup[${index}] references missing capability "${step.capability}" on surface "${surface.surface.name}".`
      })
    }

    validateIdentityRef({
      identity: step.as,
      field: `setup[${index}].as`
    })
  }

  for (const [index, task] of workflow.exploration.tasks.entries()) {
    if (!surface.capabilityMap.has(task.capability)) {
      pushIssue({
        issues,
        path: basename(workflowPath),
        message: `exploration.tasks[${index}] references missing capability "${task.capability}" on surface "${surface.surface.name}".`
      })
    }

    validateIdentityRef({
      identity: task.as,
      field: `exploration.tasks[${index}].as`
    })
  }

  for (const assertionName of workflow.hard_assertions) {
    if (!surface.assertionMap.has(assertionName)) {
      pushIssue({
        issues,
        path: basename(workflowPath),
        message: `hard_assertions references missing assertion "${assertionName}" on surface "${surface.surface.name}".`
      })
    }
  }
}

export const validateWorkspaceDefinition = ({
  config,
  surfaces,
  workflows
}: {
  config: BugScrubConfig
  surfaces: SurfaceBundle[]
  workflows: Array<{ path: string; workflow: WorkflowConfig }>
}): ValidationResult => {
  const issues: ValidationIssue[] = []
  const surfaceMap = new Map<string, ResolvedSurface>()

  for (const bundle of surfaces) {
    const resolved = buildResolvedSurface({
      bundle,
      issues
    })

    if (surfaceMap.has(resolved.surface.name)) {
      pushIssue({
        issues,
        path: `${resolved.directoryName}/surface.yaml`,
        message: `Duplicate surface name "${resolved.surface.name}".`
      })
      continue
    }

    surfaceMap.set(resolved.surface.name, resolved)
  }

  for (const workflow of workflows) {
    validateWorkflow({
      config,
      surfaceMap,
      workflow: workflow.workflow,
      workflowPath: workflow.path,
      issues
    })
  }

  return {
    issues
  }
}

export const resolveWorkspaceDefinition = ({
  surfaces
}: {
  surfaces: SurfaceBundle[]
}): Map<string, ResolvedSurface> => {
  const issues: ValidationIssue[] = []
  const surfaceMap = new Map<string, ResolvedSurface>()

  for (const bundle of surfaces) {
    const resolved = buildResolvedSurface({
      bundle,
      issues
    })
    surfaceMap.set(resolved.surface.name, resolved)
  }

  if (issues.length > 0) {
    throw new ValidationError({
      message: 'Cannot resolve workspace definition because it is invalid.',
      details: issues.map(({ path, message }) => `${path}: ${message}`)
    })
  }

  return surfaceMap
}
