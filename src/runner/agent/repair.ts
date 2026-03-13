import type { AgentName, RepairOutputInput, RunContext } from './types.js'

export const MAX_OUTPUT_REPAIR_ATTEMPTS = 2

export const buildOutputRepairPrompt = ({
  agent,
  context,
  input
}: {
  agent: AgentName
  context: RunContext
  input: RepairOutputInput
}): string => {
  return [
    'You already executed the workflow.',
    'Do not browse, click, run setup, or repeat exploration.',
    'Return only a corrected final JSON object matching the required RunResult schema.',
    `Repair attempt: ${input.attempt} of ${MAX_OUTPUT_REPAIR_ATTEMPTS}.`,
    '',
    'Requirements:',
    '- Preserve the original workflow outcome and evidence.',
    '- Fix only the final JSON payload.',
    '- Include one assertionResults entry for every hard assertion in the original prompt.',
    '- Use `not_evaluated` when an assertion was not actually verified.',
    '- Do not include markdown fences or explanation outside the JSON object.',
    '',
    'Validation issues to fix:',
    ...input.issues.map((issue) => `- ${issue}`),
    '',
    'Original workflow prompt:',
    context.prompt,
    '',
    'Previous invalid output:',
    input.previousOutput
  ].join('\n')
}
