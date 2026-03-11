import { basename } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { CliError } from '../utils/errors.js'
import { detectWorkspace, type WorkspacePackage } from './detector.js'

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

export const selectWorkspacePackage = async ({
  cwd,
  selectPackage = promptForPackageSelection
}: {
  cwd: string
  selectPackage?: (args: { packages: WorkspacePackage[] }) => Promise<WorkspacePackage>
}): Promise<{
  packageRoot: string
  selectedPackage: WorkspacePackage | undefined
}> => {
  const workspace = await detectWorkspace({ cwd })
  const selectedPackage =
    workspace.isPnpmWorkspace && workspace.packages.length > 1
      ? await selectPackage({ packages: workspace.packages })
      : workspace.packages[0]

  return {
    packageRoot: selectedPackage?.path ?? cwd,
    selectedPackage
  }
}
