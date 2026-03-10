import { Command } from 'commander'

import { logger } from '../utils/logger.js'

export const registerGenerateCommand = (program: Command): void => {
  program
    .command('generate')
    .description('Draft workflow YAML from a diff, tests, route, or workflow.')
    .option('--from-diff', 'Generate draft workflows from the current git diff.')
    .option('--from-tests', 'Generate draft workflows from existing tests.')
    .option('--from-route <path>', 'Generate a draft workflow for a route.')
    .option(
      '--from-workflow <path>',
      'Generate a draft workflow by cloning an existing workflow.'
    )
    .option('--output <filename>', 'Write the draft to a specific filename.')
    .option('--force', 'Overwrite an existing workflow file.')
    .option('--dry-run', 'Print the draft without writing it to disk.')
    .action(() => {
      logger.warn(
        '`bugscrub generate` is not implemented yet. Phase 0 only provides the CLI skeleton.'
      )
      process.exitCode = 1
    })
}
