import { nowIso } from '../utils/date.js'
import { writeTextFile } from '../utils/fs.js'
import type { AgentName, RunReport } from '../runner/agent/types.js'
import type { RunResult } from '../types/index.js'
import { renderJsonReport } from './json.js'
import { renderMarkdownReport } from './markdown.js'

export const writeRunReports = async ({
  agent,
  paths,
  result,
  runId,
  workflow
}: {
  agent: AgentName
  paths: {
    reportJsonPath: string
    reportMarkdownPath: string
  }
  result: RunResult
  runId: string
  workflow: {
    env: string
    name: string
    path: string
    surface: string
  }
}): Promise<RunReport> => {
  const report: RunReport = {
    agent,
    generatedAt: nowIso(),
    result,
    runId,
    workflow
  }

  await Promise.all([
    writeTextFile({
      path: paths.reportJsonPath,
      contents: renderJsonReport({
        report
      })
    }),
    writeTextFile({
      path: paths.reportMarkdownPath,
      contents: renderMarkdownReport({
        report
      })
    })
  ])

  return report
}
