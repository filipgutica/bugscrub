import { mkdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { getInstalledSchemaDir } from '../core/paths.js'
import type { BugScrubConfig } from '../types/index.js'
import { writeTextFile } from '../utils/fs.js'
import { stringifyYaml } from '../utils/yaml.js'

export type ScaffoldPlan = {
  directories: string[]
  files: Array<{ contents: string; path: string }>
}

export type AppliedScaffold = {
  writtenDirectories: string[]
  writtenFiles: string[]
}

const normalizeRelativePath = ({
  root,
  targetPath
}: {
  root: string
  targetPath: string
}): string => {
  const relativePath = relative(root, targetPath)
  return relativePath.length > 0 ? relativePath.split('\\').join('/') : '.'
}

const buildEditorSettings = async ({
  root
}: {
  root: string
}): Promise<string> => {
  const settingsPath = join(root, '.vscode', 'settings.json')
  const schemaDir = getInstalledSchemaDir()
  let settings: Record<string, unknown> = {}

  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const yamlSchemas =
    typeof settings['yaml.schemas'] === 'object' && settings['yaml.schemas'] !== null
      ? (settings['yaml.schemas'] as Record<string, unknown>)
      : {}

  settings['yaml.schemas'] = {
    ...yamlSchemas,
    [join(schemaDir, 'config.schema.json')]: '.bugscrub/bugscrub.config.yaml',
    [join(schemaDir, 'workflow.schema.json')]: '.bugscrub/workflows/*.yaml',
    [join(schemaDir, 'surface.schema.json')]: '.bugscrub/surfaces/*/surface.yaml',
    [join(schemaDir, 'capability.schema.json')]:
      '.bugscrub/surfaces/*/capabilities.yaml',
    [join(schemaDir, 'assertion.schema.json')]:
      '.bugscrub/surfaces/*/assertions.yaml',
    [join(schemaDir, 'signal.schema.json')]: '.bugscrub/surfaces/*/signals.yaml'
  }

  return `${JSON.stringify(settings, null, 2)}\n`
}

export const buildScaffoldPlan = async ({
  config,
  editor,
  handoff,
  report,
  root
}: {
  config: BugScrubConfig
  editor: 'vscode' | undefined
  handoff: string
  report: string
  root: string
}): Promise<ScaffoldPlan> => {
  const bugscrubRoot = join(root, '.bugscrub')
  const workflowsRoot = join(bugscrubRoot, 'workflows')
  const surfacesRoot = join(bugscrubRoot, 'surfaces')

  const directories = [
    bugscrubRoot,
    workflowsRoot,
    surfacesRoot,
    join(bugscrubRoot, 'reports')
  ]

  const files: Array<{ contents: string; path: string }> = [
    {
      path: join(bugscrubRoot, 'bugscrub.config.yaml'),
      contents: stringifyYaml(config)
    },
    {
      path: join(bugscrubRoot, 'init-report.md'),
      contents: report
    },
    {
      path: join(bugscrubRoot, 'agent-handoff.md'),
      contents: handoff
    }
  ]

  if (editor === 'vscode') {
    files.push({
      path: join(root, '.vscode', 'settings.json'),
      contents: await buildEditorSettings({ root })
    })
  }

  return {
    directories,
    files
  }
}

export const applyScaffoldPlan = async ({
  dryRun,
  plan,
  root
}: {
  dryRun: boolean
  plan: ScaffoldPlan
  root: string
}): Promise<AppliedScaffold> => {
  const writtenDirectories = plan.directories.map((directory) =>
    normalizeRelativePath({ root, targetPath: directory })
  )
  const writtenFiles = plan.files.map((file) =>
    normalizeRelativePath({ root, targetPath: file.path })
  )

  if (dryRun) {
    return {
      writtenDirectories,
      writtenFiles
    }
  }

  await Promise.all(plan.directories.map((directory) => mkdir(directory, { recursive: true })))

  for (const file of plan.files) {
    await writeTextFile({
      path: file.path,
      contents: file.contents
    })
  }

  return {
    writtenDirectories,
    writtenFiles
  }
}
