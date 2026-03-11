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
  transcriptPath: nonEmptyStringSchema.optional(),
  raw: z.record(z.string(), z.unknown()).optional()
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
        },
        raw: {
          type: 'object'
        }
      }
    }
  }
} as const
