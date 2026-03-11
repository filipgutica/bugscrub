import { ZodError } from 'zod'

import { runResultSchema } from '../../schemas/run-result.schema.js'
import type { RunResult } from '../../types/index.js'
import { CliError } from '../../utils/errors.js'

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
    const parsed = JSON.parse(output.trim()) as unknown

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
