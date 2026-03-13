import type { AssertionResult, Finding } from '../types/index.js'
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

export const repairAssertionCoverage = ({
  assertions,
  results
}: {
  assertions: ResolvedAssertion[]
  results: AssertionResult[]
}): {
  findings: Finding[]
  results: AssertionResult[]
  validation: AssertionValidationResult
} => {
  const validation = validateAssertionCoverage({
    assertions,
    results
  })
  const expected = new Map(
    assertions.flatMap((assertion) =>
      getAssertionKeys({
        assertion
      }).map((key) => [key, assertion] as const)
    )
  )
  const orderedResults: AssertionResult[] = []
  const seen = new Set<string>()
  const unexpectedAssertions: string[] = []
  const duplicateAssertions: string[] = []
  const missingAssertions: string[] = []

  for (const result of results) {
    const expectedAssertion = expected.get(result.assertion)

    if (!expectedAssertion) {
      unexpectedAssertions.push(result.assertion)
      continue
    }

    if (seen.has(expectedAssertion.name)) {
      duplicateAssertions.push(result.assertion)
      continue
    }

    seen.add(expectedAssertion.name)
    orderedResults.push({
      ...result,
      assertion: expectedAssertion.name
    })
  }

  for (const assertion of assertions) {
    if (seen.has(assertion.name)) {
      continue
    }

    missingAssertions.push(assertion.name)
    orderedResults.push({
      assertion: assertion.name,
      status: 'not_evaluated',
      summary: `BugScrub inserted this result because the agent returned an incomplete assertionResults payload for "${assertion.name}".`
    })
  }

  const findings: Finding[] =
    validation.issues.length === 0
      ? []
      : [
          {
            severity: 'medium',
            title: 'BugScrub repaired an incomplete assertionResults payload',
            description: 'The agent finished execution, but BugScrub had to normalize assertion coverage before writing the final report.',
            reproductionSteps: [
              ...(
                missingAssertions.length > 0
                  ? [`Missing assertion results were marked as not_evaluated: ${missingAssertions.join(', ')}.`]
                  : []
              ),
              ...(
                duplicateAssertions.length > 0
                  ? [`Duplicate assertion results were ignored after the first occurrence: ${duplicateAssertions.join(', ')}.`]
                  : []
              ),
              ...(
                unexpectedAssertions.length > 0
                  ? [`Unexpected assertion identifiers were dropped: ${unexpectedAssertions.join(', ')}.`]
                  : []
              )
            ]
          }
        ]

  return {
    findings,
    results: orderedResults,
    validation
  }
}
