import { join, relative } from 'node:path'

import { buildChromeDevtoolsBrowserPreflightScript, isChromeDevtoolsMcpConfigured } from './browser.js'
import { detectAvailableContainerAgents, resolveContainerAuth } from './auth.js'
import {
  createDockerArgs,
  dockerInternals,
  ensureDockerRuntime,
  readCodexLastMessage,
  runAgentInContainer,
  startContainerSession,
  stopContainerSession
} from './docker.js'
import { prepareLocalRuntimeInContainer } from './local-runtime.js'
import { createDisposableWorkspace, listWorkspaceFiles, syncBugscrubWorkspace } from './workspace.js'

export type {
  ContainerAgent,
  ContainerExecutionTarget,
  DisposableWorkspace
} from './shared.js'

export {
  createDisposableWorkspace,
  detectAvailableContainerAgents,
  ensureDockerRuntime,
  listWorkspaceFiles,
  prepareLocalRuntimeInContainer,
  readCodexLastMessage,
  runAgentInContainer,
  startContainerSession,
  stopContainerSession,
  syncBugscrubWorkspace
}

export const remapPath = ({
  fromRoot,
  path,
  toRoot
}: {
  fromRoot: string
  path: string
  toRoot: string
}): string => {
  return join(toRoot, relative(fromRoot, path))
}

export const containerInternals = {
  buildChromeDevtoolsBrowserPreflightScript,
  buildDetachedSessionArgs: dockerInternals.buildDetachedSessionArgs,
  createDockerArgs,
  isChromeDevtoolsMcpConfigured,
  resolveContainerAuth
}
