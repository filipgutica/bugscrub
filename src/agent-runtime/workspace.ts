import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

import { resolveInstalledPackageRoot } from '../utils/package-root.js'
import { fileExists } from '../utils/fs.js'
import { parseYaml, stringifyYaml } from '../utils/yaml.js'
import type { DisposableWorkspace, WorkspaceConfig, ContainerAgent } from './shared.js'
import { EXCLUDED_SOURCE_NAMES, EXCLUDED_SOURCE_PATTERNS, createSanitizedHostEnv } from './shared.js'

const shouldCopyWorkspacePath = ({
  includeNodeModules,
  source
}: {
  includeNodeModules: boolean
  source: string
}): boolean => {
  const name = basename(source)

  if (name === 'node_modules' && includeNodeModules) {
    return true
  }

  return (
    !EXCLUDED_SOURCE_NAMES.has(name) &&
    !EXCLUDED_SOURCE_PATTERNS.some((pattern) => pattern.test(name))
  )
}

const createWorkspaceCopy = async ({
  cwd,
  destination,
  includeNodeModules
}: {
  cwd: string
  destination: string
  includeNodeModules: boolean
}): Promise<void> => {
  await cp(cwd, destination, {
    filter: (source) =>
      shouldCopyWorkspacePath({
        includeNodeModules,
        source
      }),
    recursive: true
  })
}

export const createDisposableWorkspace = async ({
  agent,
  cwd,
  includeNodeModules,
  includePackagedBugscrubCli
}: {
  agent: ContainerAgent
  cwd: string
  includeNodeModules: boolean
  includePackagedBugscrubCli: boolean
}): Promise<DisposableWorkspace> => {
  const bugscrubPackageRoot = await resolveInstalledPackageRoot({
    metaUrl: import.meta.url
  })
  const sessionRoot = await mkdtemp(join(dirname(cwd), '.bugscrub-container-'))
  const tempWorkspaceRoot = join(sessionRoot, 'workspace')
  const tempBinRoot = join(sessionRoot, 'bin')
  const tempCliRoot = join(sessionRoot, 'bugscrub-cli')
  const wrapperPath = join(tempBinRoot, 'bugscrub')
  const packagedCliWrapperPath = join(tempCliRoot, 'dist', 'bugscrub')
  const sourceCliEntryPath = join(tempCliRoot, 'src', 'index.ts')
  const hasPackagedCli = await fileExists({
    path: join(bugscrubPackageRoot, 'dist', 'bugscrub')
  })

  await mkdir(tempCliRoot, {
    recursive: true
  })
  await mkdir(join(sessionRoot, 'agent-home', '.config'), {
    recursive: true
  })
  await createWorkspaceCopy({
    cwd,
    destination: tempWorkspaceRoot,
    includeNodeModules
  })

  if (includePackagedBugscrubCli) {
    if (hasPackagedCli) {
      await mkdir(tempBinRoot, {
        recursive: true
      })
    } else {
      await Promise.all([
        cp(join(bugscrubPackageRoot, 'src'), join(tempCliRoot, 'src'), {
          recursive: true
        }),
        cp(join(bugscrubPackageRoot, 'node_modules'), join(tempCliRoot, 'node_modules'), {
          recursive: true
        }),
        writeFile(
          join(tempCliRoot, 'package.json'),
          JSON.stringify(
            {
              name: 'bugscrub-container-cli',
              private: true,
              type: 'module'
            },
            null,
            2
          ),
          'utf8'
        )
      ])
    }

    await writeFile(
      wrapperPath,
      hasPackagedCli
        ? ['#!/bin/sh', `exec "${join(bugscrubPackageRoot, 'dist', 'bugscrub')}" "$@"`].join('\n')
        : [
            '#!/bin/sh',
            `exec node --import "${join(tempCliRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')}" "${sourceCliEntryPath}" "$@"`
          ].join('\n'),
      'utf8'
    )
    await chmod(wrapperPath, 0o755)

    const configPath = join(tempWorkspaceRoot, '.bugscrub', 'bugscrub.config.yaml')
    const configSource = await readFile(configPath, 'utf8')
    const parsedConfig = parseYaml<WorkspaceConfig>(configSource)

    await writeFile(
      configPath,
      stringifyYaml({
        ...parsedConfig,
        agent: {
          ...parsedConfig.agent,
          preferred: agent
        }
      }),
      'utf8'
    )
  }

  return {
    cleanup: async () => {
      await rm(sessionRoot, {
        force: true,
        recursive: true
      })
    },
    hostEnv: createSanitizedHostEnv({
      baseEnv: includePackagedBugscrubCli
        ? {
            ...process.env,
            PATH: `${tempBinRoot}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`
          }
        : process.env
    }),
    sessionRoot,
    tempWorkspaceRoot
  }
}

export const syncBugscrubWorkspace = async ({
  cwd,
  tempWorkspaceRoot
}: {
  cwd: string
  tempWorkspaceRoot: string
}): Promise<string[]> => {
  const realBugscrubRoot = join(cwd, '.bugscrub')
  const tempBugscrubRoot = join(tempWorkspaceRoot, '.bugscrub')
  const syncRoot = await mkdtemp(join(cwd, '.bugscrub-sync-'))
  const stagedBugscrubRoot = join(syncRoot, '.bugscrub')
  const backupBugscrubRoot = join(syncRoot, '.bugscrub-backup')

  await cp(tempBugscrubRoot, stagedBugscrubRoot, {
    recursive: true
  })

  const listSyncedFiles = async ({
    root,
    prefix = '.bugscrub'
  }: {
    prefix?: string
    root: string
  }): Promise<string[]> => {
    const entries = await readdir(root, {
      withFileTypes: true
    })
    const results: string[] = []

    for (const entry of entries) {
      const nextPath = join(root, entry.name)
      const nextPrefix = `${prefix}/${entry.name}`

      if (entry.isDirectory()) {
        results.push(
          ...(await listSyncedFiles({
            prefix: nextPrefix,
            root: nextPath
          }))
        )
        continue
      }

      results.push(nextPrefix)
    }

    return results
  }

  const syncedFiles = await listSyncedFiles({
    root: stagedBugscrubRoot
  })

  let movedExistingWorkspace = false

  try {
    await rename(realBugscrubRoot, backupBugscrubRoot)
    movedExistingWorkspace = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await rm(syncRoot, {
        force: true,
        recursive: true
      })
      throw error
    }
  }

  try {
    await rename(stagedBugscrubRoot, realBugscrubRoot)
  } catch (error) {
    if (movedExistingWorkspace) {
      await rename(backupBugscrubRoot, realBugscrubRoot)
    }

    await rm(syncRoot, {
      force: true,
      recursive: true
    })
    throw error
  }

  if (movedExistingWorkspace) {
    await rm(backupBugscrubRoot, {
      force: true,
      recursive: true
    })
  }

  await rm(syncRoot, {
    force: true,
    recursive: true
  })

  return syncedFiles
}

export const listWorkspaceFiles = async ({
  root
}: {
  root: string
}): Promise<string[]> => {
  const visit = async (currentPath: string): Promise<string[]> => {
    const entries = await readdir(currentPath, {
      withFileTypes: true
    })
    const files: string[] = []

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name)
      const relativePath = relative(root, entryPath).split('\\').join('/')

      if (entry.isDirectory()) {
        files.push(...(await visit(entryPath)))
        continue
      }

      if (entry.isFile()) {
        files.push(relativePath)
      }
    }

    return files
  }

  return visit(root)
}
