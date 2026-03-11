import { describe, expect, it } from 'vitest'

import {
  buildDiscoverAuthoringHandoff,
  buildInitAuthoringHandoff
} from '../../../src/init/handoff.js'

const context = {
  configFiles: ['package.json', 'vite.config.ts'],
  sampleSourceFiles: ['src/App.tsx'],
  sampleTestFiles: ['tests/app.spec.ts']
}

describe('authoring handoff guardrails', () => {
  it('forbids recursive BugScrub commands during init authoring', () => {
    const handoff = buildInitAuthoringHandoff({
      context,
      selectedPackage: undefined
    })

    expect(handoff).toContain('Do not run `bugscrub init`, `bugscrub discover`, `bugscrub generate`, `bugscrub run`, or `bugscrub schema`')
    expect(handoff).toContain('Only use `bugscrub validate`')
  })

  it('forbids recursive BugScrub commands during discover authoring', () => {
    const handoff = buildDiscoverAuthoringHandoff({
      context,
      existingSurfaces: ['settings'],
      existingWorkflows: ['settings-exploration'],
      selectedPackage: undefined
    })

    expect(handoff).toContain('Do not run `bugscrub init`, `bugscrub discover`, `bugscrub generate`, `bugscrub run`, or `bugscrub schema`')
    expect(handoff).toContain('Only use `bugscrub validate`')
  })
})
