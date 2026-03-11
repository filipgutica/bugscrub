import { Command } from 'commander'

import { executeRun } from '../runner/index.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

const parsePositiveInt = (value: string): number => {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError({
      message: `Expected a positive integer, received "${value}".`,
      exitCode: 2
    })
  }

  return parsed
}

export const runRunCommand = async ({
  cwd,
  dryRun,
  maxSteps,
  workflow
}: {
  cwd: string
  dryRun: boolean
  maxSteps: number | undefined
  workflow: string | undefined
}): Promise<void> => {
  const result = await executeRun({
    cwd,
    dryRun,
    maxSteps,
    workflow
  })

  if (dryRun) {
    process.stdout.write(`${result.dryRunOutput ?? ''}\n`)
    return
  }

  logger.success(
    `Run complete. Reports written to ${result.reportPaths?.markdown} and ${result.reportPaths?.json}.`
  )
}

export const registerRunCommand = (program: Command): void => {
  program
    .command('run')
    .description('Execute a workflow through a compatible agent adapter.')
    .option(
      '--workflow <path>',
      'Path or workflow name to execute.'
    )
    .option('--dry-run', 'Validate run inputs without launching an agent.')
    .option('--max-steps <count>', 'Override `agent.maxSteps` for this run.', parsePositiveInt)
    .action(async (options: { dryRun?: boolean; maxSteps?: number; workflow?: string }) => {
      await runRunCommand({
        cwd: process.cwd(),
        dryRun: options.dryRun ?? false,
        maxSteps: options.maxSteps,
        workflow: options.workflow
      })
    })
}
