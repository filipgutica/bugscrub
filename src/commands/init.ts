import { Command } from 'commander'
import { createInterface } from 'node:readline/promises'
import { basename } from 'node:path'

import { fileExists } from '../utils/fs.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { buildInitConfig } from '../init/bootstrap.js'
import { collectInitContext } from '../init/context.js'
import { detectProject, detectWorkspace, type WorkspacePackage } from '../init/detector.js'
import { applyScaffoldPlan, buildScaffoldPlan } from '../init/scaffolder.js'
import {
  renderInitReport,
  renderInitStdoutSummary
} from '../init/summary.js'

const promptForPackageSelection = async ({
  packages
}: {
  packages: WorkspacePackage[]
}): Promise<WorkspacePackage> => {
  if (packages.length === 0) {
    throw new CliError({
      message: 'No workspace packages were found in the current pnpm workspace.',
      exitCode: 1
    })
  }

  if (packages.length === 1) {
    return packages[0]!
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({
      message:
        'This pnpm workspace contains multiple packages. Re-run `bugscrub init` in an interactive terminal so a package can be selected.',
      exitCode: 1
    })
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    process.stdout.write('Select a pnpm workspace package to scan:\n')
    packages.forEach((pkg, index) => {
      process.stdout.write(
        `${index + 1}. ${pkg.packageName ?? basename(pkg.path)} (${pkg.relativePath})\n`
      )
    })

    while (true) {
      const answer = await prompt.question('Package number: ')
      const index = Number.parseInt(answer, 10)

      if (Number.isInteger(index) && index >= 1 && index <= packages.length) {
        return packages[index - 1]!
      }

      process.stdout.write(`Enter a number between 1 and ${packages.length}.\n`)
    }
  } finally {
    prompt.close()
  }
}

export const runInitCommand = async ({
  cwd,
  dryRun,
  editor,
  force,
  selectPackage = promptForPackageSelection
}: {
  cwd: string
  dryRun: boolean
  editor: 'vscode' | undefined
  force: boolean
  selectPackage?: (args: { packages: WorkspacePackage[] }) => Promise<WorkspacePackage>
}): Promise<void> => {
  const workspace = await detectWorkspace({ cwd })
  const selectedPackage =
    workspace.isPnpmWorkspace && workspace.packages.length > 1
      ? await selectPackage({ packages: workspace.packages })
      : workspace.packages[0]
  const packageRoot = selectedPackage?.path ?? cwd
  const bugscrubPath = `${packageRoot}/.bugscrub`

  if (!force && (await fileExists({ path: bugscrubPath }))) {
    throw new CliError({
      message:
        'A `.bugscrub/` directory already exists in the selected package. Re-run with `--force` to overwrite scaffolded files.',
      exitCode: 1
    })
  }

  const detection = await detectProject({
    root: packageRoot
  })
  const context = await collectInitContext({
    detection,
    root: packageRoot,
  })
  const { config, usesPlaceholderBaseUrl } = buildInitConfig({
    framework: detection.framework,
    packageName: detection.packageJsonName,
    packageRoot
  })

  if (detection.framework === 'unknown') {
    logger.warn(
      'No supported framework was detected. Generating a minimal scaffold and agent handoff with placeholders.'
    )
  }

  const handoff = [
    '# Agent handoff',
    '',
    `You are authoring BugScrub workspace files for \`${selectedPackage?.relativePath ?? '.'}\`.`,
    '',
    'Required work:',
    '- Inspect the selected package directly; do not rely only on this summary.',
    '- Replace placeholder values in `.bugscrub/bugscrub.config.yaml` where needed.',
    '- Create repo-specific surfaces under `.bugscrub/surfaces/<surface>/`.',
    '- Create repo-specific workflows under `.bugscrub/workflows/`.',
    '- Keep all generated YAML valid against the shipped BugScrub schemas.',
    '- Run `bugscrub validate` after writing files and fix any reported issues.',
    '',
    'Suggested repo context to review first:',
    ...context.configFiles.map((file) => `- ${file}`),
    ...context.sampleSourceFiles.slice(0, 5).map((file) => `- ${file}`),
    ...context.sampleTestFiles.slice(0, 5).map((file) => `- ${file}`)
  ].join('\n')

  const initialPlanReport = renderInitReport({
    context,
    dryRun,
    editor,
    framework: detection.framework,
    packageRoot,
    selectedPackage,
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

  process.stdout.write(
    `${renderInitStdoutSummary({
      dryRun,
      selectedPackage,
      usesPlaceholderBaseUrl,
      writtenFiles: result.writtenFiles
    })}\n`
  )
}

export const registerInitCommand = (program: Command): void => {
  program
    .command('init')
    .description('Scaffold a .bugscrub directory from the current repository.')
    .option('--dry-run', 'Print planned changes without writing files.')
    .option('--force', 'Overwrite scaffolded files when `.bugscrub/` already exists.')
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
    .action(async (options: { dryRun?: boolean; editor?: 'vscode'; force?: boolean }) => {
      await runInitCommand({
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false,
        editor: options.editor,
        force: options.force ?? false
      })
    })
}
