import type { BugScrubConfig } from '../types/index.js'

export type LocalRuntimeConfig = NonNullable<BugScrubConfig['envs'][string]['localRuntime']>

export const isLocalBaseUrl = ({
  baseUrl
}: {
  baseUrl: string
}): boolean => {
  try {
    const parsed = new URL(baseUrl)

    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export const buildRuntimeProbeUrl = ({
  baseUrl,
  readyPath
}: {
  baseUrl: string
  readyPath: string
}): string => {
  return new URL(readyPath, baseUrl).toString()
}

export const normalizeContainerRuntimeBaseUrl = ({
  baseUrl
}: {
  baseUrl: string
}): string => {
  const parsed = new URL(baseUrl)

  if (parsed.hostname === 'localhost') {
    parsed.hostname = '127.0.0.1'
  }

  return parsed.toString()
}
