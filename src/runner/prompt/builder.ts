import type { RunContext } from '../agent/types.js'
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

const buildPrompt = ({
  context,
  adapterName
}: {
  adapterName: 'claude' | 'codex'
  context: RunContext
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

export const buildClaudePrompt = ({
  context
}: {
  context: RunContext
}): string => {
  return buildPrompt({
    adapterName: 'claude',
    context
  })
}

export const buildCodexPrompt = ({
  context
}: {
  context: RunContext
}): string => {
  return buildPrompt({
    adapterName: 'codex',
    context
  })
}
