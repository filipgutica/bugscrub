import { describe, expect, it } from 'vitest'

import { repairAssertionCoverage, validateAssertionCoverage } from '../../../src/runner/assertions.js'

describe('validateAssertionCoverage', () => {
  const assertions = [
    {
      name: 'page_not_blank',
      namespacedName: 'api_requests.page_not_blank',
      kind: 'dom_presence' as const,
      description: 'Page remains visible.',
      match: {
        test_id: 'page'
      }
    },
    {
      name: 'requests_visible',
      namespacedName: 'api_requests.requests_visible',
      kind: 'dom_presence' as const,
      description: 'Requests remain visible.',
      match: {
        test_id: 'requests'
      }
    }
  ]

  it('accepts a complete assertion result payload', () => {
    expect(
      validateAssertionCoverage({
        assertions,
        results: [
          {
            assertion: 'page_not_blank',
            status: 'passed',
            summary: 'Visible.'
          },
          {
            assertion: 'requests_visible',
            status: 'passed',
            summary: 'Visible.'
          }
        ]
      }).issues
    ).toEqual([])
  })

  it('accepts namespaced assertion result identifiers', () => {
    expect(
      validateAssertionCoverage({
        assertions,
        results: [
          {
            assertion: 'api_requests.page_not_blank',
            status: 'passed',
            summary: 'Visible.'
          },
          {
            assertion: 'api_requests.requests_visible',
            status: 'passed',
            summary: 'Visible.'
          }
        ]
      }).issues
    ).toEqual([])
  })

  it('reports missing and unexpected assertions', () => {
    expect(
      validateAssertionCoverage({
        assertions,
        results: [
          {
            assertion: 'page_not_blank',
            status: 'passed',
            summary: 'Visible.'
          },
          {
            assertion: 'unexpected',
            status: 'failed',
            summary: 'Unexpected.'
          }
        ]
      }).issues
    ).toEqual([
      'Unexpected assertion result "unexpected".',
      'Missing assertion result "requests_visible".'
    ])
  })

  it('repairs incomplete assertion coverage into a reportable result set', () => {
    const repaired = repairAssertionCoverage({
      assertions,
      results: [
        {
          assertion: 'page_not_blank',
          status: 'passed',
          summary: 'Visible.'
        },
        {
          assertion: 'unexpected',
          status: 'failed',
          summary: 'Unexpected.'
        }
      ]
    })

    expect(repaired.validation.issues).toEqual([
      'Unexpected assertion result "unexpected".',
      'Missing assertion result "requests_visible".'
    ])
    expect(repaired.results).toEqual([
      {
        assertion: 'page_not_blank',
        status: 'passed',
        summary: 'Visible.'
      },
      {
        assertion: 'requests_visible',
        status: 'not_evaluated',
        summary:
          'BugScrub inserted this result because the agent returned an incomplete assertionResults payload for "requests_visible".'
      }
    ])
    expect(repaired.findings).toEqual([
      {
        severity: 'medium',
        title: 'BugScrub repaired an incomplete assertionResults payload',
        description:
          'The agent finished execution, but BugScrub had to normalize assertion coverage before writing the final report.',
        reproductionSteps: [
          'Missing assertion results were marked as not_evaluated: requests_visible.',
          'Unexpected assertion identifiers were dropped: unexpected.'
        ]
      }
    ])
  })
})
