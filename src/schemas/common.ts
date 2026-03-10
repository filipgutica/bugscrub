import { z } from 'zod'

export const nonEmptyStringSchema = z.string().trim().min(1)

export const nameSchema = nonEmptyStringSchema.regex(
  /^[A-Za-z0-9_-]+$/,
  'Must contain only letters, numbers, underscores, or hyphens.'
)

export const routeSchema = nonEmptyStringSchema.regex(
  /^\//,
  'Routes must start with "/".'
)

export const nonEmptyStringArraySchema = z.array(nonEmptyStringSchema)

export const uniqueArray = <T extends z.ZodTypeAny>({
  schema,
  label
}: {
  schema: T
  label: string
}) =>
  z.array(schema).superRefine((values, context) => {
    const seen = new Set<unknown>()

    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} values must be unique.`,
          path: [index]
        })
        return
      }

      seen.add(value)
    })
  })
