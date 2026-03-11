import type { AssertionResult } from '../types/index.js'
import type { AssertionValidationResult, ResolvedAssertion } from './agent/types.js'

const getAssertionKeys = ({
  assertion
}: {
  assertion: ResolvedAssertion
}): string[] => {
  return [assertion.name, assertion.namespacedName]
}

export const validateAssertionCoverage = ({
  assertions,
  results
}: {
  assertions: ResolvedAssertion[]
  results: AssertionResult[]
}): AssertionValidationResult => {
  const issues: string[] = []
  const expected = new Map(
    assertions.flatMap((assertion) =>
      getAssertionKeys({
        assertion
      }).map((key) => [key, assertion] as const)
    )
  )
  const seen = new Set<string>()

  for (const result of results) {
    const expectedAssertion = expected.get(result.assertion)

    if (!expectedAssertion) {
      issues.push(`Unexpected assertion result "${result.assertion}".`)
      continue
    }

    if (seen.has(expectedAssertion.name)) {
      issues.push(`Duplicate assertion result "${result.assertion}".`)
      continue
    }

    seen.add(expectedAssertion.name)
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
