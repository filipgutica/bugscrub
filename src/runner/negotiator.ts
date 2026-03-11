import { CliError } from '../utils/errors.js'
import type { AgentCapabilities } from './agent/types.js'
import { capabilityDefinitions, normalizeRequirement } from './requirements.js'

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
