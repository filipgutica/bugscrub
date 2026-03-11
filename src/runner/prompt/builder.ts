import type { BaseRunContext, RunContext } from '../agent/types.js'
import {
  authenticationSection,
  evidenceSection,
  explorationSection,
  hardAssertionsSection,
  outputFormatSection,
  roleSection,
  sessionSetupSection,
  targetSection
} from './sections.js'
import { serializePrompt } from './serializer.js'

export const buildPrompt = ({
  context,
  adapterName
}: {
  adapterName: 'claude' | 'codex'
  context: BaseRunContext
}): string => {
  return serializePrompt({
    sections: [
      roleSection(),
      `Target runtime: \`${adapterName}\``,
      targetSection({ context }),
      authenticationSection({ context }),
      sessionSetupSection({ context }),
      explorationSection({ context }),
      hardAssertionsSection({ context }),
      evidenceSection({ context }),
      outputFormatSection()
    ]
  })
}

export const buildPromptForContext = ({
  context
}: {
  context: BaseRunContext | RunContext
}): string => {
  return buildPrompt({
    adapterName: context.agent.name,
    context
  })
}
