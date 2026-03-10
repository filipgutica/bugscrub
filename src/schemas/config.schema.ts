import { z } from 'zod'

import { nameSchema, nonEmptyStringSchema } from './common.js'

export const authConfigSchema = z.union([
  z.object({
    type: z.literal('env'),
    usernameEnvVar: nonEmptyStringSchema,
    passwordEnvVar: nonEmptyStringSchema
  }),
  z.object({
    type: z.literal('token-env'),
    tokenEnvVar: nonEmptyStringSchema
  })
])

const identitySchema = z.object({
  auth: authConfigSchema
})

const environmentSchema = z.object({
  baseUrl: z.string().url(),
  defaultIdentity: nameSchema,
  identities: z.record(nameSchema, identitySchema)
})

export const bugScrubConfigSchema = z
  .object({
    version: z.literal('0'),
    project: nonEmptyStringSchema,
    defaultEnv: nameSchema,
    envs: z.record(nameSchema, environmentSchema),
    agent: z.object({
      preferred: z.enum(['auto', 'claude', 'codex']).default('auto'),
      timeout: z.number().int().positive(),
      maxBudgetUsd: z.number().positive(),
      maxSteps: z.number().int().positive().optional(),
      allowDangerousPermissions: z.boolean().optional()
    })
  })
  .superRefine(({ defaultEnv, envs }, context) => {
    if (!(defaultEnv in envs)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `defaultEnv "${defaultEnv}" must exist in envs.`,
        path: ['defaultEnv']
      })
    }

    for (const [envName, envConfig] of Object.entries(envs)) {
      if (!(envConfig.defaultIdentity in envConfig.identities)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `defaultIdentity "${envConfig.defaultIdentity}" must exist in identities.`,
          path: ['envs', envName, 'defaultIdentity']
        })
      }
    }
  })
