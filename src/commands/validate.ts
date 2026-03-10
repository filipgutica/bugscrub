import { Command } from 'commander'

import { logger } from '../utils/logger.js'

export const registerValidateCommand = (program: Command): void => {
  program
    .command('validate')
    .description('Validate BugScrub config and workflow files.')
    .option('--dry-run', 'Parse inputs without writing any generated output.')
    .action(() => {
      logger.warn(
        '`bugscrub validate` is not implemented yet. Phase 0 only provides the CLI skeleton.'
      )
      process.exitCode = 1
    })
}
