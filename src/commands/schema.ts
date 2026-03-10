import { Command } from 'commander'

import { logger } from '../utils/logger.js'

export const registerSchemaCommand = (program: Command): void => {
  program
    .command('schema')
    .description('Print or export JSON Schemas for BugScrub config types.')
    .argument('[type]', 'Schema type to print, such as workflow or surface.')
    .option('--write', 'Write all schemas to .bugscrub/generated/schemas/.')
    .action(() => {
      logger.warn(
        '`bugscrub schema` is not implemented yet. Phase 0 only provides the CLI skeleton.'
      )
      process.exitCode = 1
    })
}
