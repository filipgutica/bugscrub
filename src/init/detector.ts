import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { parseYaml } from '../utils/yaml.js'

// Init detection intentionally stays heuristic and dependency-light.
// Its goal is to produce a useful starting scaffold, not a perfect model of the
// repo, so warnings and TODOs are preferred over brittle inference.
export type InitFramework =
  | 'next-app'
  | 'next-pages'
  | 'vite-react'
  | 'vite-vue'
  | 'vite'
  | 'unknown'

export type InitTestRunner = 'vitest' | 'jest' | 'playwright' | 'cypress'

export type WorkspacePackage = {
  name: string
  packageName: string | undefined
  path: string
  relativePath: string
}

export type WorkspaceDetection = {
  cwd: string
  isPnpmWorkspace: boolean
  packages: WorkspacePackage[]
}

export type ProjectDetection = {
  framework: InitFramework
  packageJsonName: string | undefined
  testRunners: InitTestRunner[]
  warnings: string[]
}

const IGNORED_DIRECTORIES = new Set([
  '.bugscrub',
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules'
])

const toPosixPath = (value: string): string => {
  return value.split('\\').join('/')
}

const fileExists = async ({
  path
}: {
  path: string
}): Promise<boolean> => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const readJsonIfExists = async ({
  path
}: {
  path: string
}): Promise<Record<string, unknown> | undefined> => {
  try {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(path, 'utf8')
    return JSON.parse(source) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const listPackageJsonDirectories = async ({
  root
}: {
  root: string
}): Promise<string[]> => {
  const directories: string[] = []

  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true })

    const hasPackageJson = entries.some(
      (entry) => entry.isFile() && entry.name === 'package.json'
    )

    if (hasPackageJson) {
      directories.push(directoryPath)
    }

    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)
        )
        .map((entry) => visit(join(directoryPath, entry.name)))
    )
  }

  await visit(root)

  return directories
}

const matchesPatternSegments = ({
  patternSegments,
  pathSegments
}: {
  patternSegments: string[]
  pathSegments: string[]
}): boolean => {
  if (patternSegments.length === 0) {
    return pathSegments.length === 0
  }

  const [currentPattern, ...restPatterns] = patternSegments

  if (currentPattern === undefined) {
    return pathSegments.length === 0
  }

  if (currentPattern === '**') {
    if (matchesPatternSegments({ patternSegments: restPatterns, pathSegments })) {
      return true
    }

    return pathSegments.length > 0
      ? matchesPatternSegments({
          patternSegments,
          pathSegments: pathSegments.slice(1)
        })
      : false
  }

  if (pathSegments.length === 0) {
    return false
  }

  const segmentMatcher = new RegExp(
    `^${currentPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`
  )

  if (!segmentMatcher.test(pathSegments[0] ?? '')) {
    return false
  }

  return matchesPatternSegments({
    patternSegments: restPatterns,
    pathSegments: pathSegments.slice(1)
  })
}

const matchesWorkspacePattern = ({
  relativePath,
  pattern
}: {
  relativePath: string
  pattern: string
}): boolean => {
  return matchesPatternSegments({
    patternSegments: toPosixPath(pattern).split('/').filter(Boolean),
    pathSegments: toPosixPath(relativePath).split('/').filter(Boolean)
  })
}

const isWorkspacePackageIncluded = ({
  patterns,
  relativePath
}: {
  patterns: string[]
  relativePath: string
}): boolean => {
  if (patterns.length === 0) {
    return true
  }

  let isIncluded = false

  // pnpm patterns are order-sensitive: later negations or inclusions override
  // earlier matches, so this mirrors that behavior instead of short-circuiting.
  for (const pattern of patterns) {
    const isNegated = pattern.startsWith('!')
    const normalizedPattern = isNegated ? pattern.slice(1) : pattern

    if (
      normalizedPattern.length > 0 &&
      matchesWorkspacePattern({
        relativePath,
        pattern: normalizedPattern
      })
    ) {
      isIncluded = !isNegated
    }
  }

  return isIncluded
}

export const detectWorkspace = async ({
  cwd
}: {
  cwd: string
}): Promise<WorkspaceDetection> => {
  const workspaceFilePath = join(cwd, 'pnpm-workspace.yaml')

  if (!(await fileExists({ path: workspaceFilePath }))) {
    const packageJson = await readJsonIfExists({
      path: join(cwd, 'package.json')
    })

    return {
      cwd,
      isPnpmWorkspace: false,
      packages: packageJson
        ? [
            {
              name:
                typeof packageJson.name === 'string'
                  ? packageJson.name
                  : toPosixPath(relative(cwd, cwd)) || '.',
              packageName:
                typeof packageJson.name === 'string'
                  ? packageJson.name
                  : undefined,
              path: cwd,
              relativePath: '.'
            }
          ]
        : []
    }
  }

  const { readFile } = await import('node:fs/promises')
  const parsed = parseYaml<{ packages?: unknown }>(
    await readFile(workspaceFilePath, 'utf8')
  )

  const patterns = Array.isArray(parsed.packages)
    ? parsed.packages.filter((value): value is string => typeof value === 'string')
    : []

  const packageDirectories = await listPackageJsonDirectories({ root: cwd })

  const packageResults = await Promise.all(
    packageDirectories.map(async (directoryPath) => {
      const relativePath = toPosixPath(relative(cwd, directoryPath)) || '.'

      if (
        !isWorkspacePackageIncluded({
          patterns,
          relativePath
        })
      ) {
        return undefined
      }

      const packageJson = await readJsonIfExists({
        path: join(directoryPath, 'package.json')
      })

      const packageName =
        typeof packageJson?.name === 'string' ? packageJson.name : undefined

      return {
        name: packageName ?? relativePath,
        packageName,
        path: resolve(directoryPath),
        relativePath
      } satisfies WorkspacePackage
    })
  )
  const packages: WorkspacePackage[] = packageResults.filter(
    (value): value is WorkspacePackage => value !== undefined
  )

  return {
    cwd,
    isPnpmWorkspace: true,
    packages: packages.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )
  }
}

const hasAnyFile = async ({
  root,
  names
}: {
  root: string
  names: string[]
}): Promise<boolean> => {
  let entries: string[] = []

  try {
    entries = await readdir(root)
  } catch {
    return false
  }

  return names.some((name) => entries.includes(name))
}

export const detectProject = async ({
  root
}: {
  root: string
}): Promise<ProjectDetection> => {
  const nextConfigNames = [
    'next.config.js',
    'next.config.mjs',
    'next.config.ts'
  ]
  const viteConfigNames = [
    'vite.config.js',
    'vite.config.cjs',
    'vite.config.mjs',
    'vite.config.ts',
    'vite.config.cts',
    'vite.config.mts'
  ]
  const packageJson =
    (await readJsonIfExists({
      path: join(root, 'package.json')
    })) ?? {}
  const dependencyMap = {
    ...(typeof packageJson.dependencies === 'object' &&
    packageJson.dependencies !== null
      ? packageJson.dependencies
      : {}),
    ...(typeof packageJson.devDependencies === 'object' &&
    packageJson.devDependencies !== null
      ? packageJson.devDependencies
      : {})
  } as Record<string, unknown>

  const framework: InitFramework = (await hasAnyFile({
    root,
    names: nextConfigNames
  }))
    ? (await hasAnyFile({ root, names: ['app'] }))
      ? 'next-app'
      : 'next-pages'
    : (await hasAnyFile({
          root,
          names: viteConfigNames
        }))
      ? 'react' in dependencyMap
        ? 'vite-react'
        : 'vue' in dependencyMap
          ? 'vite-vue'
          : 'vite'
      : 'unknown'

  const testRunners: InitTestRunner[] = []

  if (
    'vitest' in dependencyMap ||
    (await hasAnyFile({
      root,
      names: ['vitest.config.js', 'vitest.config.mjs', 'vitest.config.ts']
    }))
  ) {
    testRunners.push('vitest')
  }

  if (
    'jest' in dependencyMap ||
    (await hasAnyFile({
      root,
      names: ['jest.config.js', 'jest.config.mjs', 'jest.config.ts']
    }))
  ) {
    testRunners.push('jest')
  }

  if (
    '@playwright/test' in dependencyMap ||
    (await hasAnyFile({
      root,
      names: ['playwright.config.js', 'playwright.config.mjs', 'playwright.config.ts']
    }))
  ) {
    testRunners.push('playwright')
  }

  if (
    'cypress' in dependencyMap ||
    (await hasAnyFile({
      root,
      names: ['cypress.config.js', 'cypress.config.mjs', 'cypress.config.ts']
    }))
  ) {
    testRunners.push('cypress')
  }

  return {
    framework,
    packageJsonName:
      typeof packageJson.name === 'string' ? packageJson.name : undefined,
    testRunners,
    warnings:
      framework === 'unknown'
        ? [
            'No supported framework was detected. BugScrub will generate a minimal scaffold with TODO markers.'
          ]
        : []
  }
}
