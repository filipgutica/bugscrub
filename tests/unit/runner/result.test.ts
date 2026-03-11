import { describe, expect, it } from 'vitest'

import { parseRunResultOutput } from '../../../src/runner/agent/result.js'
import { CliError } from '../../../src/utils/errors.js'

describe('parseRunResultOutput', () => {
  it('parses a valid run result payload', () => {
    const parsed = parseRunResultOutput({
      agent: 'codex',
      output: JSON.stringify({
        status: 'passed',
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [],
        assertionResults: [],
        evidence: {
          screenshots: [],
          networkLogs: []
        }
      })
    })

    expect(parsed.result.status).toBe('passed')
  })

  it('strips codex null placeholders for optional fields before validation', () => {
    const parsed = parseRunResultOutput({
      agent: 'codex',
      output: JSON.stringify({
        status: 'passed',
        startedAt: '2026-03-10T17:00:00.000Z',
        completedAt: '2026-03-10T17:00:02.000Z',
        durationMs: 2000,
        findings: [
          {
            severity: 'low',
            title: 'Example',
            description: 'Example description',
            reproductionSteps: ['Open the page'],
            evidence: null
          }
        ],
        assertionResults: [
          {
            assertion: 'title-visible',
            status: 'passed',
            summary: 'Title is visible',
            evidence: {
              screenshot: null,
              networkLog: null
            }
          }
        ],
        evidence: {
          screenshots: [],
          networkLogs: []
        },
        transcriptPath: null
      })
    })

    expect(parsed.result.findings[0]?.evidence).toBeUndefined()
    expect(parsed.result.assertionResults[0]?.evidence).toEqual({})
    expect(parsed.result.transcriptPath).toBeUndefined()
  })

  it('wraps malformed output in a CliError', () => {
    expect(() =>
      parseRunResultOutput({
        agent: 'claude',
        output: 'not json'
      })
    ).toThrowError(CliError)
  })

  it('wraps schema mismatches in a CliError', () => {
    expect(() =>
      parseRunResultOutput({
        agent: 'codex',
        output: JSON.stringify({
          status: 'passed'
        })
      })
    ).toThrowError(CliError)
  })
})
