import { CliError } from '../utils/errors.js'
import type { AgentCapabilities } from './agent/types.js'

const capabilityAliases: Record<string, string[]> = {
  'browser.navigation': ['browser.navigation'],
  'browser.domRead': ['browser.domRead', 'browser.dom.read'],
  'browser.networkObserve': ['browser.networkObserve', 'browser.network.observe'],
  'browser.screenshots': ['browser.screenshots', 'browser.screenshot'],
  'api.httpRequests': ['api.httpRequests', 'api.http.requests'],
  'auth.session': ['auth.session'],
  'auth.token': ['auth.token']
}

const capabilityAccessors: Record<string, (capabilities: AgentCapabilities) => boolean> = {
  'api.httpRequests': ({ api }) => api.httpRequests,
  'auth.session': ({ auth }) => auth.session,
  'auth.token': ({ auth }) => auth.token,
  'browser.domRead': ({ browser }) => browser.domRead,
  'browser.navigation': ({ browser }) => browser.navigation,
  'browser.networkObserve': ({ browser }) => browser.networkObserve,
  'browser.screenshots': ({ browser }) => browser.screenshots
}

const normalizeRequirement = ({
  requirement
}: {
  requirement: string
}): string | undefined => {
  const normalized = requirement.trim()

  for (const [canonical, aliases] of Object.entries(capabilityAliases)) {
    if (aliases.includes(normalized)) {
      return canonical
    }
  }

  return undefined
}

export const negotiateCapabilities = ({
  capabilities,
  requires
}: {
  capabilities: AgentCapabilities
  requires: string[]
}): void => {
  const missing = requires.filter((requirement) => {
    const normalized = normalizeRequirement({
      requirement
    })

    if (!normalized) {
      return true
    }

    const accessor = capabilityAccessors[normalized]

    if (!accessor) {
      return true
    }

    return !accessor(capabilities)
  })

  if (missing.length > 0) {
    throw new CliError({
      message: [
        'Capability negotiation failed.',
        ...missing.map((requirement) => `- Missing support for workflow requirement "${requirement}".`)
      ].join('\n'),
      exitCode: 1
    })
  }
}
