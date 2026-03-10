import { Command } from 'commander'

import { logger } from '../utils/logger.js'

export const registerInitCommand = (program: Command): void => {
  program
    .command('init')
    .description('Scaffold a .bugscrub directory from the current repository.')
    .option('--dry-run', 'Print planned changes without writing files.')
    .action(() => {
      logger.warn(
        '`bugscrub init` is not implemented yet. Phase 0 only provides the CLI skeleton.'
      )
      process.exitCode = 1
    })
}
