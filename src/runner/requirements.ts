import type { AgentCapabilities } from './agent/types.js'

export const capabilityDefinitions: Record<
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

export const normalizeRequirement = ({
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
