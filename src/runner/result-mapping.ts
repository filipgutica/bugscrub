import { remapPath } from '../agent-runtime/container.js'
import type { AdapterRunOutput, RunContext } from './agent/types.js'

export const toHostResult = ({
  context,
  cwd,
  output,
  startedAt
}: {
  context: RunContext
  cwd: string
  output: AdapterRunOutput
  startedAt: string
}) => {
  const remapResultPath = (path: string | undefined) =>
    path === undefined
      ? undefined
      : remapPath({
          fromRoot: context.cwd,
          path,
          toRoot: cwd
        })

  return {
    ...output.result,
    startedAt: output.result.startedAt || startedAt,
    transcriptPath: remapPath({
      fromRoot: context.cwd,
      path: context.artifacts.transcriptPath,
      toRoot: cwd
    }),
    assertionResults: output.result.assertionResults.map((assertionResult) => ({
      ...assertionResult,
      ...(assertionResult.evidence
        ? {
            evidence: {
              networkLog: remapResultPath(assertionResult.evidence.networkLog),
              screenshot: remapResultPath(assertionResult.evidence.screenshot)
            }
          }
        : {})
    })),
    evidence: {
      networkLogs: output.result.evidence.networkLogs.map((path) =>
        remapPath({
          fromRoot: context.cwd,
          path,
          toRoot: cwd
        })
      ),
      screenshots: output.result.evidence.screenshots.map((path) =>
        remapPath({
          fromRoot: context.cwd,
          path,
          toRoot: cwd
        })
      )
    },
    findings: output.result.findings.map((finding) => ({
      ...finding,
      ...(finding.evidence
        ? {
            evidence: {
              networkLog: remapResultPath(finding.evidence.networkLog),
              screenshot: remapResultPath(finding.evidence.screenshot)
            }
          }
        : {})
    }))
  }
}
