import { CliError } from '../../utils/errors.js'
import type { BugScrubConfig } from '../../types/index.js'
import type { AgentAdapter, AgentName } from './types.js'

export type DetectedAdapters = {
  available: AgentAdapter[]
  selected: AgentAdapter
}

export const detectAndSelectAdapter = async ({
  adapters,
  config
}: {
  adapters: AgentAdapter[]
  config: BugScrubConfig
}): Promise<DetectedAdapters> => {
  const detections = await Promise.all(
    adapters.map(async (adapter) => ({
      adapter,
      available: await adapter.detect()
    }))
  )
  const available = detections
    .filter((detection) => detection.available)
    .map((detection) => detection.adapter)

  const preferredOrder: AgentName[] =
    config.agent.preferred === 'auto' ? ['claude', 'codex'] : [config.agent.preferred]
  const selected = preferredOrder
    .map((name) => available.find((adapter) => adapter.name === name))
    .find((adapter): adapter is AgentAdapter => adapter !== undefined)

  if (!selected) {
    const found = available.length > 0 ? available.map((adapter) => adapter.name).join(', ') : 'none'

    throw new CliError({
      message: [
        `No supported agent runtime is available for preference "${config.agent.preferred}".`,
        `Detected runtimes: ${found}.`,
        'Install `claude` or `codex`, or update `agent.preferred` in `.bugscrub/bugscrub.config.yaml`.'
      ].join('\n'),
      exitCode: 1
    })
  }

  return {
    available,
    selected
  }
}
