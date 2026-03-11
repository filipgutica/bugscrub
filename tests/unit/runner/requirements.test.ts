import { describe, expect, it } from 'vitest'

import { normalizeRequirement } from '../../../src/runner/requirements.js'

describe('normalizeRequirement', () => {
  it('accepts canonical and alias forms of supported requirements', () => {
    expect(
      normalizeRequirement({
        requirement: 'browser.domRead'
      })
    ).toBe('browser.domRead')

    expect(
      normalizeRequirement({
        requirement: 'browser.dom.read'
      })
    ).toBe('browser.domRead')
  })

  it('rejects unsupported free-form requirements', () => {
    expect(
      normalizeRequirement({
        requirement: 'Starts from /.'
      })
    ).toBeUndefined()
  })
})
