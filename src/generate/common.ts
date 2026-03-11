import { readdir } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

// Shared generate helpers keep source inference deterministic and lightweight.
import type { SurfaceBundle } from '../core/loader.js'
import type { BugScrubConfig, WorkflowConfig } from '../types/index.js'
import { fileExists, readTextFile } from '../utils/fs.js'

const IGNORED_DIRECTORIES = new Set([
  '.bugscrub',
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules'
])

const TEST_FILE_PATTERN =
  /(?:^|\/)(?:tests?\/.*|__tests__\/.*|.*\.(?:test|spec)\.[cm]?[jt]sx?)$/i

const PAGE_GOTO_PATTERN = /\b(?:page\.goto|cy\.visit)\(\s*['"`](\/[^'"`)]*)['"`]/g

export type DraftWorkflow = {
  comments: string[]
  fileName: string
  workflow: WorkflowConfig
}

const toPosixPath = (value: string): string => {
  return value.split('\\').join('/')
}

export const toKebabCase = ({
  value
}: {
  value: string
}): string => {
  const normalized = value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return normalized.length > 0 ? normalized : 'root'
}

export const toSurfaceName = ({
  route
}: {
  route: string
}): string => {
  const normalized = route
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

  return normalized.length > 0 ? normalized : 'root'
}

const buildWorkflowName = ({
  surfaceName
}: {
  surfaceName: string
}): string => {
  return `${toKebabCase({
    value: surfaceName
  })}-exploration`
}

const buildTaskCapability = ({
  surfaceName
}: {
  surfaceName: string
}): string => {
  return `TODO_define_capability_for_${surfaceName}`
}

const findSurfaceByRoute = ({
  route,
  surfaces
}: {
  route: string
  surfaces: SurfaceBundle[]
}): SurfaceBundle | undefined => {
  return surfaces.find((surface) => surface.surface.routes.includes(route))
}

export const buildDraftFromSurface = ({
  comments,
  config,
  route,
  surface
}: {
  comments: string[]
  config: BugScrubConfig
  route?: string
  surface: SurfaceBundle
}): DraftWorkflow => {
  const setup = surface.capabilities
    .filter((capability) => capability.name === 'login')
    .map((capability) => ({
      capability: capability.name
    }))
  const tasks = surface.capabilities
    .filter((capability) => capability.name !== 'login')
    .map((capability) => ({
      capability: capability.name,
      min: 1,
      max: 2
    }))
  const workflowName = buildWorkflowName({
    surfaceName: surface.surface.name
  })

  return {
    comments: [
      ...comments,
      route
        ? `Reused existing surface "${surface.surface.name}" for route "${route}".`
        : `Reused existing surface "${surface.surface.name}".`
    ],
    fileName: `${workflowName}.yaml`,
    workflow: {
      name: workflowName,
      target: {
        surface: surface.surface.name,
        env: config.defaultEnv
      },
      requires: ['browser.navigation', 'browser.dom.read'],
      setup,
      exploration: {
        tasks:
          tasks.length > 0
            ? tasks
            : [
                {
                  capability: buildTaskCapability({
                    surfaceName: surface.surface.name
                  }),
                  min: 1,
                  max: 1
                }
              ]
      },
      hard_assertions: surface.assertions.map((assertion) => assertion.name),
      evidence: {
        screenshots: true,
        network_logs: false
      }
    }
  }
}

export const buildDraftFromRoute = ({
  comments,
  config,
  route,
  surfaces
}: {
  comments: string[]
  config: BugScrubConfig
  route: string
  surfaces: SurfaceBundle[]
}): DraftWorkflow => {
  const existingSurface = findSurfaceByRoute({
    route,
    surfaces
  })

  if (existingSurface) {
    return buildDraftFromSurface({
      comments,
      config,
      route,
      surface: existingSurface
    })
  }

  const surfaceName = toSurfaceName({
    route
  })
  const workflowName = buildWorkflowName({
    surfaceName
  })

  return {
    comments: [
      ...comments,
      `No existing surface matched route "${route}". Generated a draft against stub surface "${surfaceName}".`,
      `Add or update .bugscrub/surfaces/${surfaceName}/ before validating or running this workflow.`
    ],
    fileName: `${workflowName}.yaml`,
    workflow: {
      name: workflowName,
      target: {
        surface: surfaceName,
        env: config.defaultEnv
      },
      requires: ['browser.navigation', 'browser.dom.read'],
      setup: [],
      exploration: {
        tasks: [
          {
            capability: buildTaskCapability({
              surfaceName
            }),
            min: 1,
            max: 1
          }
        ]
      },
      hard_assertions: [],
      evidence: {
        screenshots: true,
        network_logs: false
      }
    }
  }
}

export const listRepoFiles = async ({
  root
}: {
  root: string
}): Promise<string[]> => {
  const files: string[] = []

  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = join(directoryPath, entry.name)

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath)
        }

        continue
      }

      files.push(toPosixPath(relative(root, absolutePath)))
    }
  }

  await visit(root)
  return files.sort((left, right) => left.localeCompare(right))
}

export const isTestFile = ({
  relativePath
}: {
  relativePath: string
}): boolean => {
  return TEST_FILE_PATTERN.test(relativePath)
}

export const extractRoutesFromSource = ({
  source
}: {
  source: string
}): string[] => {
  const routes = new Set<string>()

  for (const match of source.matchAll(PAGE_GOTO_PATTERN)) {
    const route = match[1]?.trim()

    if (route) {
      routes.add(route)
    }
  }

  return [...routes]
}

export const inferRouteFromPath = ({
  relativePath
}: {
  relativePath: string
}): string | undefined => {
  const segments = toPosixPath(relativePath).split('/').filter(Boolean)

  if (segments[0] === 'app' && /^page\./i.test(segments.at(-1) ?? '')) {
    const routeSegments = segments
      .slice(1, -1)
      .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'))

    return routeSegments.length > 0 ? `/${routeSegments.join('/')}` : '/'
  }

  if (segments[0] === 'pages') {
    const fileName = segments.at(-1) ?? ''
    const baseName = basename(fileName, extname(fileName))

    if (
      baseName !== '_app' &&
      baseName !== '_document' &&
      baseName !== '_error' &&
      segments[1] !== 'api'
    ) {
      const routeSegments = [...segments.slice(1, -1), baseName === 'index' ? '' : baseName].filter(
        Boolean
      )

      return routeSegments.length > 0 ? `/${routeSegments.join('/')}` : '/'
    }
  }

  return undefined
}

export const extractRoutesFromFile = async ({
  path,
  relativePath
}: {
  path: string
  relativePath: string
}): Promise<string[]> => {
  const routes = new Set<string>()
  const inferredFromPath = inferRouteFromPath({
    relativePath
  })

  if (inferredFromPath) {
    routes.add(inferredFromPath)
  }

  if (await fileExists({ path })) {
    const source = await readTextFile({ path })

    for (const route of extractRoutesFromSource({
      source
    })) {
      routes.add(route)
    }
  }

  return [...routes]
}
