import { ZodError } from 'zod'

import { runResultSchema } from '../../schemas/run-result.schema.js'
import type { RunResult } from '../../types/index.js'
import { CliError } from '../../utils/errors.js'

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

    throw new CliError({
      message: `Invalid ${agent} run result output.\n${detail}`,
      exitCode: 1
    })
  }
}
