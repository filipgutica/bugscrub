import { z } from 'zod'

import { findingSchema } from './finding.schema.js'
import { nonEmptyStringSchema } from './common.js'

export const assertionResultSchema = z.object({
  assertion: nonEmptyStringSchema,
  status: z.enum(['passed', 'failed', 'not_evaluated']),
  summary: nonEmptyStringSchema,
  evidence: z
    .object({
      screenshot: nonEmptyStringSchema.optional(),
      networkLog: nonEmptyStringSchema.optional()
    })
    .optional()
})

export const runResultSchema = z.object({
  status: z.enum(['passed', 'failed', 'error']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  findings: z.array(findingSchema),
  assertionResults: z.array(assertionResultSchema),
  evidence: z.object({
    screenshots: z.array(nonEmptyStringSchema).default([]),
    networkLogs: z.array(nonEmptyStringSchema).default([])
  }),
  transcriptPath: nonEmptyStringSchema.optional()
})

export const runResultJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $ref: '#/definitions/runResultSchema',
  definitions: {
    runResultSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'startedAt',
        'completedAt',
        'durationMs',
        'findings',
        'assertionResults',
        'evidence'
      ],
      properties: {
        status: {
          type: 'string',
          enum: ['passed', 'failed', 'error']
        },
        startedAt: {
          type: 'string',
          format: 'date-time'
        },
        completedAt: {
          type: 'string',
          format: 'date-time'
        },
        durationMs: {
          type: 'integer',
          minimum: 0
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['severity', 'title', 'description', 'reproductionSteps'],
            properties: {
              severity: {
                type: 'string',
                enum: ['low', 'medium', 'high']
              },
              title: {
                type: 'string',
                minLength: 1
              },
              description: {
                type: 'string',
                minLength: 1
              },
              reproductionSteps: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1
                }
              },
              evidence: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  screenshot: {
                    type: 'string',
                    minLength: 1
                  },
                  networkLog: {
                    type: 'string',
                    minLength: 1
                  }
                }
              }
            }
          }
        },
        assertionResults: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['assertion', 'status', 'summary'],
            properties: {
              assertion: {
                type: 'string',
                minLength: 1
              },
              status: {
                type: 'string',
                enum: ['passed', 'failed', 'not_evaluated']
              },
              summary: {
                type: 'string',
                minLength: 1
              },
              evidence: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  screenshot: {
                    type: 'string',
                    minLength: 1
                  },
                  networkLog: {
                    type: 'string',
                    minLength: 1
                  }
                }
              }
            }
          }
        },
        evidence: {
          type: 'object',
          additionalProperties: false,
          required: ['screenshots', 'networkLogs'],
          properties: {
            screenshots: {
              type: 'array',
              items: {
                type: 'string',
                minLength: 1
              }
            },
            networkLogs: {
              type: 'array',
              items: {
                type: 'string',
                minLength: 1
              }
            }
          }
        },
        transcriptPath: {
          type: 'string',
          minLength: 1
        }
      }
    }
  }
} as const

type JsonSchema = {
  additionalProperties?: boolean
  enum?: readonly string[]
  format?: string
  items?: JsonSchema
  minLength?: number
  minimum?: number
  properties?: Record<string, JsonSchema> | Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  type?: string | string[]
}

const makeCodexNullable = ({ schema }: { schema: JsonSchema }): JsonSchema => {
  if (!schema.type) {
    return schema
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type]

  if (types.includes('null')) {
    return schema
  }

  return {
    ...schema,
    type: [...types, 'null']
  }
}

const toCodexCompatibleSchema = ({ schema }: { schema: JsonSchema }): JsonSchema => {
  const transformedItems = schema.items
    ? toCodexCompatibleSchema({
        schema: schema.items
      })
    : undefined

  const transformedProperties = schema.properties
    ? Object.fromEntries(
        Object.entries(schema.properties).map(([key, propertySchema]) => {
          const transformedProperty = toCodexCompatibleSchema({
            schema: propertySchema
          })
          const requiredKeys = new Set(schema.required ?? [])

          return [
            key,
            requiredKeys.has(key)
              ? transformedProperty
              : makeCodexNullable({
                  schema: transformedProperty
                })
          ]
        })
      )
    : undefined

  if (!transformedProperties) {
    return {
      ...schema,
      ...(transformedItems
        ? {
            items: transformedItems
          }
        : {})
    }
  }

  return {
    ...schema,
    ...(transformedItems
      ? {
          items: transformedItems
        }
      : {}),
    properties: transformedProperties,
    required: Object.keys(transformedProperties)
  }
}

export const codexRunResultJsonSchema = toCodexCompatibleSchema({
  schema: runResultJsonSchema.definitions.runResultSchema
})
