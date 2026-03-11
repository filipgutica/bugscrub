import { Command } from 'commander'
import { join } from 'node:path'

import { loadBugScrubConfig } from '../core/config.js'
import { loadWorkspaceFiles } from '../core/loader.js'
import { authorWorkspace, type InitAuthorResult } from '../init/author.js'
import { collectInitContext } from '../init/context.js'
import { detectProject, type WorkspacePackage } from '../init/detector.js'
import { buildDiscoverAuthoringHandoff } from '../init/handoff.js'
import { promptForPackageSelection, selectWorkspacePackage } from '../init/package-selection.js'
import { CliError } from '../utils/errors.js'
import { fileExists, writeTextFile } from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import { runValidateCommand } from './validate.js'

const renderDiscoverReport = ({
  existingSurfaces,
  existingWorkflows,
  packageRoot
}: {
  existingSurfaces: string[]
  existingWorkflows: string[]
  packageRoot: string
}): string => {
  return [
    '# BugScrub discover report',
    '',
    '## Scope',
    `- Package root: \`${packageRoot}\``,
    '',
    '## Existing workspace',
    `- Surfaces: ${existingSurfaces.join(', ') || 'none'}`,
    `- Workflows: ${existingWorkflows.join(', ') || 'none'}`,
    '',
    '## Next step',
    '- An authoring agent will inspect the repo and add missing surfaces/workflows without replacing valid existing files.',
    ''
  ].join('\n')
}

const renderDiscoverSummary = ({
  agent,
  dryRun,
  selectedPackage
}: {
  agent: string | undefined
  dryRun: boolean
  selectedPackage: WorkspacePackage | undefined
}): string => {
  const targetLabel = selectedPackage?.relativePath ?? '.'
  const lines = [
    `BugScrub discover ${dryRun ? 'previewed' : 'completed'} for ${targetLabel === '.' ? 'the current package' : targetLabel}.`,
    dryRun
      ? 'Authoring handoff prepared for the selected agent.'
      : `Missing-surface/workflow authoring executed via ${agent ?? 'the selected agent'}.`
  ]

  return lines.join('\n')
}

export const runDiscoverCommand = async ({
  authorRepo = authorWorkspace,
  cwd,
  dryRun,
  selectPackage = promptForPackageSelection
}: {
  authorRepo?: (args: {
    config: Awaited<ReturnType<typeof loadBugScrubConfig>>
    cwd: string
    prompt: string
  }) => Promise<InitAuthorResult>
  cwd: string
  dryRun: boolean
  selectPackage?: (args: { packages: WorkspacePackage[] }) => Promise<WorkspacePackage>
}): Promise<void> => {
  const { packageRoot, selectedPackage } = await selectWorkspacePackage({
    cwd,
    selectPackage
  })
  const bugscrubPath = `${packageRoot}/.bugscrub`

  if (!(await fileExists({ path: bugscrubPath }))) {
    throw new CliError({
      message:
        'No `.bugscrub/` directory exists in the selected package. Run `bugscrub init` first.',
      exitCode: 1
    })
  }

  const [config, workspace, detection] = await Promise.all([
    loadBugScrubConfig({ cwd: packageRoot }),
    loadWorkspaceFiles({ cwd: packageRoot }),
    detectProject({
      root: packageRoot
    })
  ])
  const context = await collectInitContext({
    detection,
    root: packageRoot
  })
  const existingSurfaces = workspace.surfaces.map((surface) => surface.surface.name).sort()
  const existingWorkflows = workspace.workflows.map((workflow) => workflow.workflow.name).sort()
  const handoff = buildDiscoverAuthoringHandoff({
    context,
    existingSurfaces,
    existingWorkflows,
    selectedPackage
  })

  if (!dryRun) {
    await Promise.all([
      writeTextFile({
        path: join(bugscrubPath, 'discover-report.md'),
        contents: `${renderDiscoverReport({
          existingSurfaces,
          existingWorkflows,
          packageRoot
        })}\n`
      }),
      writeTextFile({
        path: join(bugscrubPath, 'discover-handoff.md'),
        contents: `${handoff}\n`
      })
    ])
  }

  let authorResult: InitAuthorResult | undefined

  if (!dryRun) {
    logger.info('Invoking the selected agent to author missing surfaces and workflows.')
    authorResult = await authorRepo({
      config,
      cwd: packageRoot,
      prompt: handoff
    })
    logger.info(`Authoring log written to ${authorResult.logPath}.`)
    await runValidateCommand({ cwd: packageRoot })
  }

  process.stdout.write(
    `${renderDiscoverSummary({
      agent: authorResult?.agent,
      dryRun,
      selectedPackage
    })}\n`
  )
}

export const registerDiscoverCommand = (program: Command): void => {
  program
    .command('discover')
    .description('Rescan an initialized repo and author missing surfaces or workflows.')
    .option('--dry-run', 'Print the authoring intent without writing files.')
    .action(async (options: { dryRun?: boolean }) => {
      await runDiscoverCommand({
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false
      })
    })
}
