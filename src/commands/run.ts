import { Command } from 'commander'

import { logger } from '../utils/logger.js'

export const registerRunCommand = (program: Command): void => {
  program
    .command('run')
    .description('Execute a workflow through a compatible agent adapter.')
    .option(
      '--workflow <path>',
      'Path to a workflow file. Later phases will default this when possible.'
    )
    .option('--dry-run', 'Validate run inputs without launching an agent.')
    .action(() => {
      logger.warn(
        '`bugscrub run` is not implemented yet. Phase 0 only provides the CLI skeleton.'
      )
      process.exitCode = 1
    })
}
