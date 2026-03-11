import { createInterface } from 'node:readline/promises'

import { Command } from 'commander'

// `generate` turns a single source of truth into one or more workflow drafts.
import { loadBugScrubConfig } from '../core/config.js'
import { loadWorkspaceFiles, type SurfaceBundle } from '../core/loader.js'
import { generateDraftFromWorkflow } from '../generate/clone.js'
import { generateDraftsFromDiff, type DiffMode } from '../generate/diff.js'
import { generateDraftFromRoute } from '../generate/route.js'
import { generateDraftsFromTests } from '../generate/tests.js'
import type { DraftWorkflow } from '../generate/common.js'
import { renderDraftWorkflow, writeDrafts } from '../generate/writer.js'
import { promptForPackageSelection, selectWorkspacePackage } from '../init/package-selection.js'
import type { BugScrubConfig } from '../types/index.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { promptForChoice } from '../utils/tty-select.js'
import type { WorkspacePackage } from '../init/detector.js'

type InteractiveSource =
  | { kind: 'route'; route: string }
  | { kind: 'workflow'; workflowPath: string }
  | { diffMode: DiffMode; kind: 'diff' }
  | { kind: 'tests' }

const promptForBranchName = async (): Promise<string> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({
      message: 'Branch selection requires an interactive terminal.',
      exitCode: 1
    })
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    const branch = (await prompt.question('Base branch: ')).trim()

    if (branch.length === 0) {
      throw new CliError({
        message: 'A base branch name is required.',
        exitCode: 1
      })
    }

    return branch
  } finally {
    prompt.close()
  }
}

const promptForGenerateSource = async (): Promise<InteractiveSource> => {
  const selected = await promptForChoice({
    choices: [
      {
        label: 'From current local changes',
        value: 'local' as const
      },
      {
        label: 'Compare current branch to main',
        value: 'main' as const
      },
      {
        label: 'Compare current branch to another branch',
        value: 'branch' as const
      },
      {
        label: 'From tests',
        value: 'tests' as const
      }
    ],
    title: 'Select a generation source:'
  })

  if (selected === 'local') {
    return {
      kind: 'diff',
      diffMode: {
        kind: 'local'
      }
    }
  }

  if (selected === 'main') {
    return {
      kind: 'diff',
      diffMode: {
        kind: 'main'
      }
    }
  }

  if (selected === 'branch') {
    return {
      kind: 'diff',
      diffMode: {
        kind: 'branch',
        baseBranch: await promptForBranchName()
      }
    }
  }

  return {
    kind: 'tests'
  }
}

const resolveGenerateSource = async ({
  fromRoute,
  fromWorkflow,
  promptForSource
}: {
  fromRoute?: string
  fromWorkflow?: string
  promptForSource: () => Promise<InteractiveSource>
}): Promise<InteractiveSource> => {
  const explicitSources = [fromRoute ? 'route' : undefined, fromWorkflow ? 'workflow' : undefined].filter(
    Boolean
  )

  if (explicitSources.length > 1) {
    throw new CliError({
      message: 'Use only one explicit generate source at a time.',
      exitCode: 2
    })
  }

  if (fromRoute) {
    return {
      kind: 'route',
      route: fromRoute
    }
  }

  if (fromWorkflow) {
    return {
      kind: 'workflow',
      workflowPath: fromWorkflow
    }
  }

  return promptForSource()
}

const createDraftsForSource = async ({
  config,
  cwd,
  source,
  surfaces
}: {
  config: BugScrubConfig
  cwd: string
  source: InteractiveSource
  surfaces: SurfaceBundle[]
}): Promise<DraftWorkflow[]> => {
  if (source.kind === 'route') {
    return [
      generateDraftFromRoute({
        config,
        route: source.route,
        surfaces
      })
    ]
  }

  if (source.kind === 'workflow') {
    return [
      await generateDraftFromWorkflow({
        cwd,
        workflowPath: source.workflowPath
      })
    ]
  }

  if (source.kind === 'tests') {
    return generateDraftsFromTests({
      config,
      cwd,
      surfaces
    })
  }

  return generateDraftsFromDiff({
    config,
    cwd,
    mode: source.diffMode,
    surfaces
  })
}

const renderDryRunOutput = ({
  drafts,
  output
}: {
  drafts: DraftWorkflow[]
  output?: string
}): string => {
  return drafts
    .map((draft) => {
      const destination = output ?? `.bugscrub/workflows/${draft.fileName}`

      return [`# ${destination}`, renderDraftWorkflow({ draft }).trimEnd()].join('\n')
    })
    .join('\n\n---\n\n')
}

export const runGenerateCommand = async ({
  cwd,
  dryRun,
  filter,
  force,
  fromRoute,
  fromWorkflow,
  output,
  promptForBranch = promptForBranchName,
  promptForSource = promptForGenerateSource,
  selectPackage = promptForPackageSelection
}: {
  cwd: string
  dryRun: boolean
  filter?: string
  force: boolean
  fromRoute?: string
  fromWorkflow?: string
  output?: string
  promptForBranch?: () => Promise<string>
  promptForSource?: () => Promise<InteractiveSource>
  selectPackage?: (args: { packages: WorkspacePackage[] }) => Promise<WorkspacePackage>
}): Promise<void> => {
  const { packageRoot } = await selectWorkspacePackage({
    cwd,
    ...(filter ? { filter } : {}),
    selectPackage
  })
  const [config, workspace] = await Promise.all([
    loadBugScrubConfig({ cwd: packageRoot }),
    loadWorkspaceFiles({ cwd: packageRoot })
  ])
  const source = await resolveGenerateSource({
    ...(fromRoute ? { fromRoute } : {}),
    ...(fromWorkflow ? { fromWorkflow } : {}),
    promptForSource: async () => {
      const selected = await promptForSource()

      if (selected.kind === 'diff' && selected.diffMode.kind === 'branch') {
        return {
          kind: 'diff',
          diffMode: {
            kind: 'branch',
            baseBranch:
              selected.diffMode.baseBranch.length > 0
                ? selected.diffMode.baseBranch
                : await promptForBranch()
          }
        }
      }

      return selected
    }
  })
  const drafts = await createDraftsForSource({
    config,
    cwd: packageRoot,
    source,
    surfaces: workspace.surfaces
  })

  if (dryRun) {
    process.stdout.write(
      `${renderDryRunOutput({
        drafts,
        ...(output ? { output } : {})
      })}\n`
    )
    return
  }

  const writtenPaths = await writeDrafts({
    cwd: packageRoot,
    drafts,
    force,
    ...(output ? { output } : {})
  })

  logger.success(
    `Generated ${writtenPaths.length} workflow draft${writtenPaths.length === 1 ? '' : 's'}:\n${writtenPaths.map((path) => `- ${path}`).join('\n')}`
  )
}

export const registerGenerateCommand = (program: Command): void => {
  program
    .command('generate')
    .description(
      'Draft workflow YAML from an interactive source picker, a route, or an existing workflow.'
    )
    .option('--from-route <path>', 'Generate a draft workflow for a route.')
    .option(
      '--from-workflow <path>',
      'Generate a draft workflow by cloning and adapting an existing workflow.'
    )
    .option('--output <filename>', 'Write the draft to a specific filename.')
    .option('--force', 'Overwrite an existing workflow file.')
    .option('--dry-run', 'Print the draft without writing it to disk.')
    .action(
      async (
        options: {
          dryRun?: boolean
          force?: boolean
          fromRoute?: string
          fromWorkflow?: string
          output?: string
        },
        command: Command
      ) => {
        const globals = command.optsWithGlobals() as { filter?: string }

        await runGenerateCommand({
          cwd: process.cwd(),
          dryRun: options.dryRun ?? false,
          force: options.force ?? false,
          ...(globals.filter ? { filter: globals.filter } : {}),
          ...(options.fromRoute ? { fromRoute: options.fromRoute } : {}),
          ...(options.fromWorkflow ? { fromWorkflow: options.fromWorkflow } : {}),
          ...(options.output ? { output: options.output } : {})
        })
      }
    )
}
