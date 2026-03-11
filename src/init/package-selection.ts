import { basename } from 'node:path'

import { CliError } from '../utils/errors.js'
import { promptForChoice } from '../utils/tty-select.js'
import { detectWorkspace, type WorkspacePackage } from './detector.js'

// Workspace selection centralizes monorepo targeting for package-scoped commands.
export const promptForPackageSelection = async ({
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
        'This pnpm workspace contains multiple packages. Re-run the command in an interactive terminal so a package can be selected.',
      exitCode: 1
    })
  }

  return promptForChoice({
    choices: packages.map((pkg) => ({
      label: `${pkg.packageName ?? basename(pkg.path)} (${pkg.relativePath})`,
      value: pkg
    })),
    title: 'Select a pnpm workspace package:'
  })
}

export const selectWorkspacePackage = async ({
  cwd,
  filter,
  selectPackage = promptForPackageSelection
}: {
  cwd: string
  filter?: string
  selectPackage?: (args: { packages: WorkspacePackage[] }) => Promise<WorkspacePackage>
}): Promise<{
  packageRoot: string
  selectedPackage: WorkspacePackage | undefined
}> => {
  const workspace = await detectWorkspace({ cwd })
  let selectedPackage: WorkspacePackage | undefined

  if (filter) {
    const matches = workspace.packages.filter(
      (pkg) => pkg.packageName === filter || pkg.relativePath === filter
    )

    if (matches.length === 0) {
      throw new CliError({
        message: `No pnpm workspace package matched "${filter}".`,
        exitCode: 1
      })
    }

    if (matches.length > 1) {
      throw new CliError({
        message: [
          `Multiple pnpm workspace packages matched "${filter}".`,
          'Use the relative path to disambiguate.'
        ].join('\n'),
        exitCode: 1
      })
    }

    selectedPackage = matches[0]
  } else {
    selectedPackage =
      workspace.isPnpmWorkspace && workspace.packages.length > 1
        ? await selectPackage({ packages: workspace.packages })
        : workspace.packages[0]
  }

  return {
    packageRoot: selectedPackage?.path ?? cwd,
    selectedPackage
  }
}
