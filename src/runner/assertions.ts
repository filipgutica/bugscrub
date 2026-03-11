import type { AssertionResult } from '../types/index.js'
import type { AssertionValidationResult, ResolvedAssertion } from './agent/types.js'

export const validateAssertionCoverage = ({
  assertions,
  results
}: {
  assertions: ResolvedAssertion[]
  results: AssertionResult[]
}): AssertionValidationResult => {
  const issues: string[] = []
  const expected = new Map(assertions.map((assertion) => [assertion.name, assertion]))
  const seen = new Set<string>()

  for (const result of results) {
    if (!expected.has(result.assertion)) {
      issues.push(`Unexpected assertion result "${result.assertion}".`)
      continue
    }

    if (seen.has(result.assertion)) {
      issues.push(`Duplicate assertion result "${result.assertion}".`)
      continue
    }

    seen.add(result.assertion)
  }

  for (const assertion of assertions) {
    if (!seen.has(assertion.name)) {
      issues.push(`Missing assertion result "${assertion.name}".`)
    }
  }

  return {
    issues
  }
}
