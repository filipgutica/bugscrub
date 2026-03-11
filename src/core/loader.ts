import { basename, join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { z } from 'zod'

import { assertionsFileSchema } from '../schemas/assertion.schema.js'
import { capabilitiesFileSchema } from '../schemas/capability.schema.js'
import { signalsFileSchema } from '../schemas/signal.schema.js'
import { surfaceSchema } from '../schemas/surface.schema.js'
import { workflowSchema } from '../schemas/workflow.schema.js'
import type {
  AssertionConfig,
  CapabilityConfig,
  SignalConfig,
  SurfaceConfig,
  WorkflowConfig
} from '../types/index.js'
import { ValidationError } from '../utils/errors.js'
import { fileExists, readTextFile } from '../utils/fs.js'
import { parseYaml } from '../utils/yaml.js'
import { getRepoPaths } from './paths.js'

// Loader is the filesystem boundary for repo-authored YAML.
// It reads each file family separately so validation errors stay tied to the
// exact source file instead of being deferred until runtime resolution.
type SurfaceBundle = {
  directoryName: string
  directoryPath: string
  surface: SurfaceConfig
  capabilities: CapabilityConfig[]
  assertions: AssertionConfig[]
  signals: SignalConfig[]
}

const formatIssues = ({
  fileLabel,
  issues
}: {
  fileLabel: string
  issues: z.ZodIssue[]
}) => {
  return issues.map(({ message, path }) => {
    const suffix = path.length === 0 ? '' : `.${path.map(String).join('.')}`
    return `${fileLabel}${suffix}: ${message}`
  })
}

const parseYamlFile = async <TSchema extends z.ZodTypeAny>({
  path,
  schema,
  fileLabel
}: {
  path: string
  schema: TSchema
  fileLabel: string
}): Promise<z.infer<TSchema>> => {
  const source = await readTextFile({ path })
  const parsed = parseYaml<unknown>(source)
  const result = schema.safeParse(parsed)

  if (!result.success) {
    throw new ValidationError({
      message: `Invalid YAML in ${path}.`,
      details: formatIssues({
        fileLabel,
        issues: result.error.issues
      })
    })
  }

  return result.data
}

export const loadWorkflowFile = async ({
  path
}: {
  path: string
}): Promise<WorkflowConfig> => {
  return parseYamlFile({
    path,
    schema: workflowSchema,
    fileLabel: basename(path)
  })
}

export const loadSurfaceBundle = async ({
  directoryPath,
  directoryName
}: {
  directoryPath: string
  directoryName: string
}): Promise<SurfaceBundle> => {
  const surfacePath = join(directoryPath, 'surface.yaml')
  const capabilitiesPath = join(directoryPath, 'capabilities.yaml')
  const assertionsPath = join(directoryPath, 'assertions.yaml')
  const signalsPath = join(directoryPath, 'signals.yaml')

  const surface = await parseYamlFile({
    path: surfacePath,
    schema: surfaceSchema,
    fileLabel: `${directoryName}/surface.yaml`
  })
  const capabilities = await parseYamlFile({
    path: capabilitiesPath,
    schema: capabilitiesFileSchema,
    fileLabel: `${directoryName}/capabilities.yaml`
  })
  const assertions = await parseYamlFile({
    path: assertionsPath,
    schema: assertionsFileSchema,
    fileLabel: `${directoryName}/assertions.yaml`
  })
  const signals = await parseYamlFile({
    path: signalsPath,
    schema: signalsFileSchema,
    fileLabel: `${directoryName}/signals.yaml`
  })

  return {
    directoryName,
    directoryPath,
    surface,
    capabilities,
    assertions,
    signals
  }
}

export const loadWorkspaceFiles = async ({
  cwd
}: {
  cwd: string
}): Promise<{
  workflows: Array<{ path: string; workflow: WorkflowConfig }>
  surfaces: SurfaceBundle[]
}> => {
  const { bugscrubDir, surfacesDir, workflowsDir } = getRepoPaths({ cwd })

  if (!(await fileExists({ path: bugscrubDir }))) {
    throw new ValidationError({
      message: `BugScrub config directory not found at ${bugscrubDir}.`,
      details: ['Expected a `.bugscrub/` directory in the current working tree.']
    })
  }

  const [surfaceEntries, workflowEntries] = await Promise.all([
    fileExists({ path: surfacesDir })
      .then(async (exists) =>
        exists
          ? readdir(surfacesDir, { withFileTypes: true })
          : []
      ),
    fileExists({ path: workflowsDir })
      .then(async (exists) =>
        exists
          ? readdir(workflowsDir, { withFileTypes: true })
          : []
      )
  ])

  // Surface directories are intentionally loaded as bundles because the four
  // YAML files are validated independently but resolved together later on.
  const surfaces = await Promise.all(
    surfaceEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        loadSurfaceBundle({
          directoryName: entry.name,
          directoryPath: join(surfacesDir, entry.name)
        })
      )
  )

  const workflowFiles = workflowEntries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(workflowsDir, entry.name))

  const workflows = await Promise.all(
    workflowFiles.map(async (path) => ({
      path,
      workflow: await loadWorkflowFile({ path })
    }))
  )

  return {
    workflows,
    surfaces
  }
}

export type { SurfaceBundle }
