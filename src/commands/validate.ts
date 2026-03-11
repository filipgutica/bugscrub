import { Command } from 'commander'

import { loadBugScrubConfig } from '../core/config.js'
import { loadWorkspaceFiles } from '../core/loader.js'
import { validateWorkspaceDefinition } from '../core/resolver.js'
import { selectWorkspacePackage } from '../init/package-selection.js'
import { CliError, ValidationError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

export const runValidateCommand = async ({
  cwd,
  filter
}: {
  cwd: string
  filter?: string
}): Promise<void> => {
  try {
    const { packageRoot } = await selectWorkspacePackage({
      cwd,
      ...(filter ? { filter } : {})
    })
    const config = await loadBugScrubConfig({ cwd: packageRoot })
    const workspace = await loadWorkspaceFiles({ cwd: packageRoot })
    const result = validateWorkspaceDefinition({
      config,
      surfaces: workspace.surfaces,
      workflows: workspace.workflows
    })

    if (result.issues.length > 0) {
      throw new CliError({
        message: [
          `Validation failed with ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}:`,
          ...result.issues.map(({ message, path }) => `- ${path}: ${message}`)
        ].join('\n'),
        exitCode: 1
      })
    }

    logger.success('Validation passed.')
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new CliError({
        message: [error.message, ...error.details.map((detail) => `- ${detail}`)].join(
          '\n'
        ),
        exitCode: 1
      })
    }

    throw error
  }
}

export const registerValidateCommand = (program: Command): void => {
  program
    .command('validate')
    .description('Validate BugScrub config and workflow files.')
    .action(async (_options: object, command: Command) => {
      const globals = command.optsWithGlobals() as { filter?: string }

      await runValidateCommand({
        cwd: process.cwd(),
        ...(globals.filter ? { filter: globals.filter } : {})
      })
    })
}
