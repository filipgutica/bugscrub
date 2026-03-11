import { describe, expect, it, vi, afterEach } from 'vitest'

import { runSchemaCommand } from '../../../src/commands/schema.js'
import { CliError } from '../../../src/utils/errors.js'

describe('runSchemaCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the requested schema as JSON', () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)

    runSchemaCommand({ type: 'workflow' })

    expect(writeSpy).toHaveBeenCalledTimes(1)

    const printed = String(writeSpy.mock.calls[0]?.[0] ?? '')
    const parsed = JSON.parse(printed)

    expect(parsed.$ref).toBe('#/definitions/workflowSchema')
    expect(parsed.definitions.workflowSchema).toBeDefined()
  })

  it('supports the run-result schema type', () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)

    runSchemaCommand({ type: 'run-result' })

    const printed = String(writeSpy.mock.calls[0]?.[0] ?? '')
    const parsed = JSON.parse(printed)

    expect(parsed.$ref).toBe('#/definitions/runResultSchema')
    expect(parsed.definitions.runResultSchema).toBeDefined()
  })

  it('throws a usage error for unknown schema types', () => {
    expect(() => {
      runSchemaCommand({ type: 'nope' })
    }).toThrowError(CliError)

    try {
      runSchemaCommand({ type: 'nope' })
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect((error as CliError).exitCode).toBe(2)
    }
  })
})
