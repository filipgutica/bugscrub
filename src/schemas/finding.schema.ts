import { z } from 'zod'

import { nonEmptyStringArraySchema, nonEmptyStringSchema } from './common.js'

export const findingSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  reproductionSteps: nonEmptyStringArraySchema,
  evidence: z
    .object({
      screenshot: nonEmptyStringSchema.optional(),
      networkLog: nonEmptyStringSchema.optional()
    })
    .optional()
})
