import { z } from 'zod'

import { nameSchema, nonEmptyStringSchema } from './common.js'

const assertionBaseSchema = z.object({
  name: nameSchema,
  description: nonEmptyStringSchema
})

const domMatchSchema = z.object({
  test_id: nonEmptyStringSchema
})

export const assertionSchema = z.discriminatedUnion('kind', [
  assertionBaseSchema.extend({
    kind: z.literal('dom_presence'),
    match: domMatchSchema
  }),
  assertionBaseSchema.extend({
    kind: z.literal('dom_absence'),
    match: domMatchSchema
  }),
  assertionBaseSchema.extend({
    kind: z.literal('text_visible'),
    match: z.object({
      text: nonEmptyStringSchema
    })
  }),
  assertionBaseSchema.extend({
    kind: z.literal('url_match'),
    match: z.object({
      pathname: nonEmptyStringSchema.regex(
        /^\//,
        'Pathname must start with "/".'
      )
    })
  }),
  assertionBaseSchema.extend({
    kind: z.literal('network_status'),
    match: z.object({
      urlContains: nonEmptyStringSchema,
      status: z.number().int().min(100).max(599)
    })
  })
])

export const assertionsFileSchema = z.array(assertionSchema)
