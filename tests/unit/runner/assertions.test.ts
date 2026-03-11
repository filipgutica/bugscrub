import { describe, expect, it } from 'vitest'

import { validateAssertionCoverage } from '../../../src/runner/assertions.js'

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
})
