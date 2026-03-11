import { describe, expect, it } from 'vitest'

import { codexRunResultJsonSchema } from '../../../src/schemas/run-result.schema.js'

describe('codexRunResultJsonSchema', () => {
  it('marks nested object properties as required for codex structured output', () => {
    const rootProperties = codexRunResultJsonSchema.properties!
    const findingEvidence = rootProperties.findings!.items!.properties!.evidence!
    const assertionEvidence = rootProperties.assertionResults!.items!.properties!.evidence!

    expect(findingEvidence.required).toEqual(['screenshot', 'networkLog'])
    expect(assertionEvidence.required).toEqual(['screenshot', 'networkLog'])
    expect(findingEvidence.type).toEqual(['object', 'null'])
    expect(assertionEvidence.properties!.screenshot!.type).toEqual(['string', 'null'])
    expect(codexRunResultJsonSchema.required).toEqual([
      'status',
      'startedAt',
      'completedAt',
      'durationMs',
      'findings',
      'assertionResults',
      'evidence',
      'transcriptPath'
    ])
  })
})
