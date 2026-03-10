import { z } from 'zod'

import { nameSchema, uniqueArray } from './common.js'

const workflowStepSchema = z.object({
  capability: nameSchema,
  as: nameSchema.optional()
})

const workflowTaskSchema = workflowStepSchema
  .extend({
    min: z.number().int().min(1),
    max: z.number().int().min(1)
  })
  .superRefine(({ max, min }, context) => {
    if (max < min) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`max` must be greater than or equal to `min`.',
        path: ['max']
      })
    }
  })

export const workflowSchema = z.object({
  name: nameSchema,
  target: z.object({
    surface: nameSchema,
    env: nameSchema
  }),
  requires: z.array(z.string().trim().min(1)).default([]),
  setup: z.array(workflowStepSchema).default([]),
  exploration: z.object({
    tasks: z.array(workflowTaskSchema)
  }),
  hard_assertions: uniqueArray({
    schema: nameSchema,
    label: 'hard_assertions'
  }).default([]),
  evidence: z.object({
    screenshots: z.boolean(),
    network_logs: z.boolean()
  })
})
