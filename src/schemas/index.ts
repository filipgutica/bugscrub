import { zodToJsonSchema } from 'zod-to-json-schema'

import { assertionSchema } from './assertion.schema.js'
import { capabilitySchema } from './capability.schema.js'
import { bugScrubConfigSchema } from './config.schema.js'
import { findingSchema } from './finding.schema.js'
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
  config: bugScrubConfigSchema
} as const

export type SchemaType = keyof typeof schemaMap

export const schemaTypes = Object.keys(schemaMap) as SchemaType[]

export const getSchemaByType = ({ type }: { type: SchemaType }) => {
  return schemaMap[type]
}

export const getJsonSchemaByType = ({ type }: { type: SchemaType }) => {
  return zodToJsonSchema(getSchemaByType({ type }) as never, {
    name: `${type}Schema`,
    target: 'jsonSchema7'
  })
}
