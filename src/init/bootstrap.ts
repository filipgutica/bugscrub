import { basename } from 'node:path'

import { bugScrubConfigSchema } from '../schemas/config.schema.js'
import type { BugScrubConfig } from '../types/index.js'

export const inferProjectName = ({
  packageName,
  rootName
}: {
  packageName: string | undefined
  rootName: string
}): string => {
  const candidate = packageName?.split('/').pop() ?? rootName
  return candidate.replace(/^@/, '').replace(/[^A-Za-z0-9_-]+/g, '-')
}

export const inferBaseUrl = ({
  framework
}: {
  framework: 'next-app' | 'next-pages' | 'vite-react' | 'vite-vue' | 'vite' | 'unknown'
}): { baseUrl: string; usesPlaceholder: boolean } => {
  if (framework === 'next-app' || framework === 'next-pages') {
    return {
      baseUrl: 'http://localhost:3000',
      usesPlaceholder: false
    }
  }

  if (
    framework === 'vite' ||
    framework === 'vite-react' ||
    framework === 'vite-vue'
  ) {
    return {
      baseUrl: 'http://localhost:5173',
      usesPlaceholder: false
    }
  }

  return {
    baseUrl: 'https://example.com',
    usesPlaceholder: true
  }
}

export const buildInitConfig = ({
  framework,
  packageName,
  packageRoot
}: {
  framework: 'next-app' | 'next-pages' | 'vite-react' | 'vite-vue' | 'vite' | 'unknown'
  packageName: string | undefined
  packageRoot: string
}): {
  config: BugScrubConfig
  usesPlaceholderBaseUrl: boolean
} => {
  const baseUrl = inferBaseUrl({
    framework
  })

  return {
    config: bugScrubConfigSchema.parse({
      version: '0',
      project: inferProjectName({
        packageName,
        rootName: basename(packageRoot)
      }),
      defaultEnv: 'local',
      envs: {
        local: {
          baseUrl: baseUrl.baseUrl,
          defaultIdentity: 'local_user',
          identities: {
            local_user: {
              auth: {
                type: 'env',
                usernameEnvVar: 'BUGSCRUB_LOCAL_USER',
                passwordEnvVar: 'BUGSCRUB_LOCAL_PASS'
              }
            }
          }
        }
      },
      agent: {
        preferred: 'auto',
        timeout: 300,
        maxBudgetUsd: 5,
        maxSteps: 20
      }
    }),
    usesPlaceholderBaseUrl: baseUrl.usesPlaceholder
  }
}
