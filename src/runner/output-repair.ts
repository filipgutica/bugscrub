import { logger } from '../utils/logger.js'
import { InvalidRunResultError } from './agent/result.js'
import { MAX_OUTPUT_REPAIR_ATTEMPTS } from './agent/repair.js'
import type { AdapterRunOutput, AgentAdapter, RunContext } from './agent/types.js'

export const appendAdapterArtifacts = ({
  current,
  next
}: {
  current: AdapterRunOutput
  next: AdapterRunOutput
}): AdapterRunOutput => {
  return {
    artifacts: {
      stderr: [current.artifacts.stderr, next.artifacts.stderr].filter(Boolean).join('\n'),
      stdout: [current.artifacts.stdout, next.artifacts.stdout].filter(Boolean).join('\n')
    },
    rawResponse: next.rawResponse,
    result: next.result
  }
}

export const repairInvalidAdapterOutput = async ({
  adapter,
  context,
  error,
  existingOutput,
  initialAttempt
}: {
  adapter: AgentAdapter
  context: RunContext
  error: InvalidRunResultError
  existingOutput?: AdapterRunOutput
  initialAttempt: number
}): Promise<{
  attemptsUsed: number
  output: AdapterRunOutput
}> => {
  if (!adapter.repairOutput) {
    throw error
  }

  let latestError: InvalidRunResultError = error
  const latestOutput = existingOutput

  for (let attempt = initialAttempt; attempt <= MAX_OUTPUT_REPAIR_ATTEMPTS; attempt += 1) {
    logger.warn(
      [
        `Agent returned invalid structured output. BugScrub is requesting a repair-only response (attempt ${attempt}/${MAX_OUTPUT_REPAIR_ATTEMPTS}).`,
        ...latestError.issues.map((issue) => `- ${issue}`)
      ].join('\n')
    )

    try {
      const repairedOutput = await adapter.repairOutput(context, {
        attempt,
        issues: latestError.issues,
        previousOutput: latestError.rawOutput
      })

      return {
        attemptsUsed: attempt,
        output:
          latestOutput === undefined
            ? repairedOutput
            : appendAdapterArtifacts({
                current: latestOutput,
                next: repairedOutput
              })
      }
    } catch (repairError) {
      if (!(repairError instanceof InvalidRunResultError)) {
        throw repairError
      }

      latestError = repairError
    }
  }

  throw latestError
}
