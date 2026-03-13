import { access, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

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

type InitPackageManager = 'npm' | 'pnpm' | 'yarn'

const inferPackageManager = async ({
  packageRoot
}: {
  packageRoot: string
}): Promise<InitPackageManager> => {
  try {
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8')
    ) as { packageManager?: unknown }

    if (typeof packageJson.packageManager === 'string') {
      if (packageJson.packageManager.startsWith('pnpm@')) {
        return 'pnpm'
      }

      if (packageJson.packageManager.startsWith('yarn@')) {
        return 'yarn'
      }

      if (packageJson.packageManager.startsWith('npm@')) {
        return 'npm'
      }
    }
  } catch {
    // Fall through to lockfile detection.
  }

  let currentRoot = packageRoot

  while (true) {
    for (const [fileName, manager] of [
      ['pnpm-workspace.yaml', 'pnpm'],
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm']
    ] as const) {
      try {
        await access(join(currentRoot, fileName))
        return manager
      } catch {
        // Keep checking.
      }
    }

    const parentRoot = dirname(currentRoot)

    if (parentRoot === currentRoot) {
      break
    }

    currentRoot = parentRoot
  }

  return 'npm'
}

const buildLocalRuntime = async ({
  framework,
  packageRoot
}: {
  framework: 'next-app' | 'next-pages' | 'vite-react' | 'vite-vue' | 'vite' | 'unknown'
  packageRoot: string
}) => {
  if (framework === 'unknown') {
    return undefined
  }

  const packageManager = await inferPackageManager({
    packageRoot
  })
  const installCommand =
    packageManager === 'pnpm'
      ? 'pnpm install --frozen-lockfile'
      : packageManager === 'yarn'
        ? 'yarn install --frozen-lockfile'
        : 'npm install'

  if (framework === 'next-app' || framework === 'next-pages') {
    return {
      cwd: '.',
      installCommand,
      readyPath: '/',
      readyTimeoutMs: 120_000,
      startCommand:
        packageManager === 'pnpm'
          ? 'pnpm dev --hostname 127.0.0.1 --port 3000'
          : packageManager === 'yarn'
            ? 'yarn dev --hostname 127.0.0.1 --port 3000'
            : 'npm run dev -- --hostname 127.0.0.1 --port 3000'
    }
  }

  return {
    cwd: '.',
    installCommand,
    readyPath: '/',
    readyTimeoutMs: 120_000,
    startCommand:
      packageManager === 'pnpm'
        ? 'pnpm dev --host 127.0.0.1 --port 5173'
        : packageManager === 'yarn'
          ? 'yarn dev --host 127.0.0.1 --port 5173'
          : 'npm run dev -- --host 127.0.0.1 --port 5173'
  }
}

export const buildInitConfig = async ({
  framework,
  packageName,
  packageRoot
}: {
  framework: 'next-app' | 'next-pages' | 'vite-react' | 'vite-vue' | 'vite' | 'unknown'
  packageName: string | undefined
  packageRoot: string
}): Promise<{
  config: BugScrubConfig
  usesPlaceholderBaseUrl: boolean
}> => {
  const baseUrl = inferBaseUrl({
    framework
  })
  const localRuntime = await buildLocalRuntime({
    framework,
    packageRoot
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
          },
          ...(localRuntime
            ? {
                localRuntime
              }
            : {})
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
