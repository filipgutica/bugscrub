import { z } from 'zod'

import {
  nameSchema,
  nonEmptyStringArraySchema,
  nonEmptyStringSchema,
  uniqueArray
} from './common.js'

export const capabilitySchema = z.object({
  name: nameSchema,
  description: nonEmptyStringSchema,
  preconditions: nonEmptyStringArraySchema.default([]),
  guidance: nonEmptyStringArraySchema.default([]),
  success_signals: uniqueArray({
    schema: nameSchema,
    label: 'success_signals'
  }).default([]),
  failure_signals: uniqueArray({
    schema: nameSchema,
    label: 'failure_signals'
  }).default([])
})

export const capabilitiesFileSchema = z.array(capabilitySchema)
