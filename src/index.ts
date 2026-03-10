#!/usr/bin/env node

import { Command } from 'commander'
import { fileURLToPath } from 'node:url'

import { registerGenerateCommand } from './commands/generate.js'
import { registerInitCommand } from './commands/init.js'
import { registerRunCommand } from './commands/run.js'
import { registerSchemaCommand } from './commands/schema.js'
import { registerValidateCommand } from './commands/validate.js'
import { logger } from './utils/logger.js'

export const buildCli = (): Command => {
  const program = new Command()

  program
    .name('bugscrub')
    .description(
      'Schema-driven CLI for capability-bounded exploratory bug scrub workflows.'
    )
    .version('0.0.0')

  registerInitCommand(program)
  registerValidateCommand(program)
  registerGenerateCommand(program)
  registerRunCommand(program)
  registerSchemaCommand(program)

  return program
}

const run = async (): Promise<void> => {
  const cli = buildCli()
  await cli.parseAsync(process.argv)
}

const entrypointPath = process.argv[1]

if (entrypointPath && fileURLToPath(import.meta.url) === entrypointPath) {
  run().catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
