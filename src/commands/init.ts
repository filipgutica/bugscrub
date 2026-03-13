import { Command } from 'commander'

import { authorWorkspace, type InitAuthorResult } from '../init/author.js'
import { buildInitConfig } from '../init/bootstrap.js'
import { collectInitContext } from '../init/context.js'
import { detectProject, type WorkspacePackage } from '../init/detector.js'
import { buildInitAuthoringHandoff } from '../init/handoff.js'
import { promptForPackageSelection, selectWorkspacePackage } from '../init/package-selection.js'
import { applyScaffoldPlan, buildScaffoldPlan } from '../init/scaffolder.js'
import { renderInitReport, renderInitStdoutSummary } from '../init/summary.js'
import { fileExists } from '../utils/fs.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { runValidateCommand } from './validate.js'

export const runInitCommand = async ({
  authorRepo = authorWorkspace,
  cwd,
  dryRun,
  editor,
  filter,
  skipScan = false,
  selectPackage = promptForPackageSelection
}: {
  authorRepo?: (args: {
    config: Awaited<ReturnType<typeof buildInitConfig>>['config']
    cwd: string
    prompt: string
  }) => Promise<InitAuthorResult>
  cwd: string
  dryRun: boolean
  editor: 'vscode' | undefined
  filter?: string
  skipScan?: boolean
  selectPackage?: (args: { packages: WorkspacePackage[] }) => Promise<WorkspacePackage>
}): Promise<void> => {
  const { packageRoot, selectedPackage } = await selectWorkspacePackage({
    cwd,
    ...(filter ? { filter } : {}),
    selectPackage
  })
  const bugscrubPath = `${packageRoot}/.bugscrub`

  if (await fileExists({ path: bugscrubPath })) {
    throw new CliError({
      message:
        'A `.bugscrub/` directory already exists in the selected package. `bugscrub init` is only for first-time bootstrap. Use `bugscrub discover` to rescan and author missing surfaces or workflows.',
      exitCode: 1
    })
  }

  const detection = await detectProject({
    root: packageRoot
  })
  const context = await collectInitContext({
    detection,
    root: packageRoot
  })
  const { config, usesPlaceholderBaseUrl } = await buildInitConfig({
    framework: detection.framework,
    packageName: detection.packageJsonName,
    packageRoot
  })

  if (detection.framework === 'unknown') {
    logger.warn(
      'No supported framework was detected. Generating a minimal scaffold and agent handoff with placeholders.'
    )
  }

  const handoff = buildInitAuthoringHandoff({
    context,
    selectedPackage
  })
  const initialPlanReport = renderInitReport({
    context,
    dryRun,
    editor,
    framework: detection.framework,
    packageRoot,
    selectedPackage,
    skipScan,
    testRunners: detection.testRunners,
    usesPlaceholderBaseUrl,
    writtenDirectories: ['.bugscrub', '.bugscrub/workflows', '.bugscrub/surfaces', '.bugscrub/reports'],
    writtenFiles: [
      '.bugscrub/bugscrub.config.yaml',
      '.bugscrub/init-report.md',
      '.bugscrub/agent-handoff.md',
      ...(editor === 'vscode' ? ['.vscode/settings.json'] : [])
    ]
  })
  const initialPlan = await buildScaffoldPlan({
    config,
    editor,
    handoff,
    report: initialPlanReport,
    root: packageRoot
  })
  const result = await applyScaffoldPlan({
    dryRun,
    plan: initialPlan,
    root: packageRoot
  })
  let authorResult: InitAuthorResult | undefined

  if (!dryRun && !skipScan) {
    logger.info('Invoking the selected agent to author repo-specific surfaces and workflows.')
    authorResult = await authorRepo({
      config,
      cwd: packageRoot,
      prompt: handoff
    })
    logger.info(`Authoring log written to ${authorResult.logPath}.`)
    await runValidateCommand({ cwd: packageRoot })
  }

  process.stdout.write(
    `${renderInitStdoutSummary({
      author: !skipScan,
      authorAgent: authorResult?.agent,
      dryRun,
      selectedPackage,
      usesPlaceholderBaseUrl,
      writtenFiles: result.writtenFiles,
      ...(authorResult?.authoredFiles
        ? {
            authoredFiles: authorResult.authoredFiles
          }
        : {})
    })}\n`
  )
}

export const registerInitCommand = (program: Command): void => {
  program
    .command('init')
    .description('Scaffold a .bugscrub directory and invoke an authoring agent.')
    .option('--dry-run', 'Print planned changes without writing files.')
    .option('--skip-scan', 'Write only the deterministic scaffold and skip agent authoring.')
    .option(
      '--editor <editor>',
      'Write optional editor integration settings.',
      (value: string) => {
        if (value !== 'vscode') {
          throw new CliError({
            message: `Unknown editor "${value}". Valid editors: vscode.`,
            exitCode: 2
          })
        }

        return value as 'vscode'
      }
    )
    .action(
      async (
        options: { dryRun?: boolean; editor?: 'vscode'; skipScan?: boolean },
        command: Command
      ) => {
      const globals = command.optsWithGlobals() as { filter?: string }

      await runInitCommand({
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false,
        editor: options.editor,
        skipScan: options.skipScan ?? false,
        ...(globals.filter ? { filter: globals.filter } : {})
      })
      }
    )
}
