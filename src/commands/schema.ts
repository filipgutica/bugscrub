import { Command } from 'commander'

import { getJsonSchemaByType, schemaTypes, type SchemaType } from '../schemas/index.js'
import { CliError } from '../utils/errors.js'

export const runSchemaCommand = ({
  type
}: {
  type: string
}): void => {
  if (!schemaTypes.includes(type as SchemaType)) {
    throw new CliError({
      message: `Unknown schema type "${type}". Valid types: ${schemaTypes.join(', ')}.`,
      exitCode: 2
    })
  }

  process.stdout.write(
    `${JSON.stringify(getJsonSchemaByType({ type: type as SchemaType }), null, 2)}\n`
  )
}

export const registerSchemaCommand = (program: Command): void => {
  program
    .command('schema')
    .description('Print a JSON Schema for a BugScrub config type.')
    .argument('<type>', `Schema type to print. One of: ${schemaTypes.join(', ')}.`)
    .action((type: string) => {
      runSchemaCommand({ type })
    })
}
