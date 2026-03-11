import { CliError } from '../utils/errors.js'
import type { AgentCapabilities } from './agent/types.js'

// Capability negotiation normalizes workflow requirements before an adapter run starts.
const capabilityDefinitions: Record<
  string,
  {
    aliases: string[]
    check: (capabilities: AgentCapabilities) => boolean
  }
> = {
  'api.httpRequests': {
    aliases: ['api.httpRequests', 'api.http.requests'],
    check: ({ api }) => api.httpRequests
  },
  'auth.session': {
    aliases: ['auth.session'],
    check: ({ auth }) => auth.session
  },
  'auth.token': {
    aliases: ['auth.token'],
    check: ({ auth }) => auth.token
  },
  'browser.domRead': {
    aliases: ['browser.domRead', 'browser.dom.read'],
    check: ({ browser }) => browser.domRead
  },
  'browser.navigation': {
    aliases: ['browser.navigation'],
    check: ({ browser }) => browser.navigation
  },
  'browser.networkObserve': {
    aliases: ['browser.networkObserve', 'browser.network.observe'],
    check: ({ browser }) => browser.networkObserve
  },
  'browser.screenshots': {
    aliases: ['browser.screenshots', 'browser.screenshot'],
    check: ({ browser }) => browser.screenshots
  }
}

const normalizeRequirement = ({
  requirement
}: {
  requirement: string
}): string | undefined => {
  const normalized = requirement.trim()

  for (const [canonical, definition] of Object.entries(capabilityDefinitions)) {
    if (definition.aliases.includes(normalized)) {
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

    const definition = capabilityDefinitions[normalized]

    if (!definition) {
      return true
    }

    return !definition.check(capabilities)
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
