import { z } from 'zod'

import { nameSchema, nonEmptyStringSchema } from './common.js'

const signalBaseSchema = z.object({
  name: nameSchema,
  description: nonEmptyStringSchema
})

export const signalSchema = z.discriminatedUnion('kind', [
  signalBaseSchema.extend({
    kind: z.literal('dom_change'),
    target: z.object({
      test_id: nonEmptyStringSchema
    })
  }),
  signalBaseSchema.extend({
    kind: z.literal('network_request'),
    target: z.object({
      urlContains: nonEmptyStringSchema
    })
  }),
  signalBaseSchema.extend({
    kind: z.literal('url_change')
  })
])

export const signalsFileSchema = z.array(signalSchema)
