import { readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import type { ProjectDetection } from './detector.js'

export type InitContext = {
  configFiles: string[]
  packageJsonName: string | undefined
  sampleSourceFiles: string[]
  sampleTestFiles: string[]
}

const IGNORED_DIRECTORIES = new Set([
  '.bugscrub',
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules'
])

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.js',
  'vite.config.cjs',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cts',
  'vite.config.mts',
  'vitest.config.js',
  'vitest.config.cjs',
  'vitest.config.mjs',
  'vitest.config.ts',
  'vitest.config.cts',
  'vitest.config.mts',
  'jest.config.js',
  'jest.config.cjs',
  'jest.config.mjs',
  'jest.config.ts',
  'playwright.config.js',
  'playwright.config.cjs',
  'playwright.config.mjs',
  'playwright.config.ts',
  'cypress.config.js',
  'cypress.config.cjs',
  'cypress.config.mjs',
  'cypress.config.ts'
])

const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|vue)$/i
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:tests?\/.*|__tests__\/.*|.*\.(?:test|spec)\.[cm]?[jt]sx?)$/i

const toPosixPath = (value: string): string => {
  return value.split('\\').join('/')
}

const isSourceSample = ({ relativePath }: { relativePath: string }): boolean => {
  return (
    SOURCE_FILE_PATTERN.test(relativePath) &&
    !TEST_FILE_PATTERN.test(relativePath) &&
    /^(?:app|pages|src)\//.test(relativePath)
  )
}

const visitFiles = async ({
  directoryPath,
  files,
  root
}: {
  directoryPath: string
  files: string[]
  root: string
}): Promise<void> => {
  const entries = await readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await visitFiles({
          directoryPath: absolutePath,
          files,
          root
        })
      }

      continue
    }

    files.push(toPosixPath(relative(root, absolutePath)))
  }
}

export const collectInitContext = async ({
  detection,
  root
}: {
  detection: ProjectDetection
  root: string
}): Promise<InitContext> => {
  const files: string[] = []

  await visitFiles({
    directoryPath: root,
    files,
    root
  })

  const sortedFiles = files.sort((left, right) => left.localeCompare(right))

  return {
    configFiles: sortedFiles.filter((filePath) =>
      CONFIG_FILE_NAMES.has(basename(filePath))
    ),
    packageJsonName: detection.packageJsonName,
    sampleSourceFiles: sortedFiles.filter((filePath) =>
      isSourceSample({ relativePath: filePath })
    ).slice(0, 10),
    sampleTestFiles: sortedFiles.filter((filePath) =>
      TEST_FILE_PATTERN.test(filePath)
    ).slice(0, 10)
  }
}
