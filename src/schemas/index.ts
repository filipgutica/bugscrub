import { z } from 'zod'

import { assertionSchema } from './assertion.schema.js'
import { capabilitySchema } from './capability.schema.js'
import { bugScrubConfigSchema } from './config.schema.js'
import { findingSchema } from './finding.schema.js'
import { runResultJsonSchema, runResultSchema } from './run-result.schema.js'
import { signalSchema } from './signal.schema.js'
import { surfaceSchema } from './surface.schema.js'
import { workflowSchema } from './workflow.schema.js'

export const schemaMap = {
  workflow: workflowSchema,
  surface: surfaceSchema,
  capability: capabilitySchema,
  assertion: assertionSchema,
  signal: signalSchema,
  finding: findingSchema,
  config: bugScrubConfigSchema,
  'run-result': runResultSchema
} as const

export type SchemaType = keyof typeof schemaMap

export const schemaTypes = Object.keys(schemaMap) as SchemaType[]

export const getSchemaByType = ({ type }: { type: SchemaType }) => {
  return schemaMap[type]
}

const getSchemaDefinitionName = ({
  type
}: {
  type: SchemaType
}): string => {
  return `${type.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}Schema`
}

export const getJsonSchemaByType = ({ type }: { type: SchemaType }) => {
  if (type === 'run-result') {
    return runResultJsonSchema
  }

  const definitionName = getSchemaDefinitionName({ type })
  const definitionSchema = z.toJSONSchema(getSchemaByType({ type }), {
    target: 'draft-7'
  })

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $ref: `#/definitions/${definitionName}`,
    definitions: {
      [definitionName]: {
        ...definitionSchema,
        $schema: undefined
      }
    }
  }
}
