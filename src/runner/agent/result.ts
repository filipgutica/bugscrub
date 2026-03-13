import { ZodError } from 'zod'

import { runResultSchema } from '../../schemas/run-result.schema.js'
import type { RunResult } from '../../types/index.js'
import { CliError } from '../../utils/errors.js'

export class InvalidRunResultError extends CliError {
  public readonly agent: 'claude' | 'codex'
  public readonly issues: string[]
  public readonly rawOutput: string

  public constructor({
    agent,
    issues,
    rawOutput
  }: {
    agent: 'claude' | 'codex'
    issues: string[]
    rawOutput: string
  }) {
    super({
      message: [`Invalid ${agent} run result output.`, ...issues].join('\n'),
      exitCode: 1
    })
    this.agent = agent
    this.issues = issues
    this.name = 'InvalidRunResultError'
    this.rawOutput = rawOutput
  }
}

const stripNullOptionals = ({ value }: { value: unknown }): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) =>
      stripNullOptionals({
        value: item
      })
    )
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null)
      .map(([key, entryValue]) => [
        key,
        stripNullOptionals({
          value: entryValue
        })
      ])
  )
}

export const parseRunResultOutput = ({
  agent,
  output
}: {
  agent: 'claude' | 'codex'
  output: string
}): {
  parsed: unknown
  result: RunResult
} => {
  try {
    const parsed = stripNullOptionals({
      value: JSON.parse(output.trim()) as unknown
    })

    return {
      parsed,
      result: runResultSchema.parse(parsed)
    }
  } catch (error) {
    const detail =
      error instanceof ZodError
        ? error.issues.map((issue) => issue.message).join('; ')
        : error instanceof Error
          ? error.message
          : 'Unknown parse failure.'

    throw new InvalidRunResultError({
      agent,
      issues: [detail],
      rawOutput: output
    })
  }
}
