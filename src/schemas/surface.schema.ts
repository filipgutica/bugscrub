import { z } from 'zod'

import {
  nameSchema,
  routeSchema,
  uniqueArray
} from './common.js'

export const surfaceSchema = z.object({
  name: nameSchema,
  routes: uniqueArray({
    schema: routeSchema,
    label: 'routes'
  }),
  elements: z
    .record(
      nameSchema,
      z.object({
        test_id: z.string().trim().min(1)
      })
    )
    .default({}),
  capabilities: uniqueArray({
    schema: nameSchema,
    label: 'capabilities'
  })
})
