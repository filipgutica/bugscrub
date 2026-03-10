#!/usr/bin/env node

import { Command, CommanderError } from 'commander'
import { fileURLToPath } from 'node:url'

import { registerGenerateCommand } from './commands/generate.js'
import { registerInitCommand } from './commands/init.js'
import { registerRunCommand } from './commands/run.js'
import { registerSchemaCommand } from './commands/schema.js'
import { registerValidateCommand } from './commands/validate.js'
import { CliError } from './utils/errors.js'
import { logger } from './utils/logger.js'

export const buildCli = (): Command => {
  const program = new Command()

  program
    .name('bugscrub')
    .description(
      'Schema-driven CLI for capability-bounded exploratory bug scrub workflows.'
    )
    .version('0.0.0')
    .exitOverride()

  registerInitCommand(program)
  registerValidateCommand(program)
  registerGenerateCommand(program)
  registerRunCommand(program)
  registerSchemaCommand(program)

  return program
}

const run = async (): Promise<void> => {
  const cli = buildCli()

  try {
    await cli.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.version'
      ) {
        process.exitCode = 0
        return
      }

      throw new CliError({
        message: error.message,
        exitCode: 2
      })
    }

    throw error
  }
}

const entrypointPath = process.argv[1]

if (entrypointPath && fileURLToPath(import.meta.url) === entrypointPath) {
  run().catch((error: unknown) => {
    if (error instanceof CliError) {
      logger.error(error.message)
      process.exitCode = error.exitCode
      return
    }

    logger.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
