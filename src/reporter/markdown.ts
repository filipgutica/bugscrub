import type { RunReport } from '../runner/agent/types.js'

const renderAssertionChecklist = ({
  report
}: {
  report: RunReport
}): string[] => {
  if (report.result.assertionResults.length === 0) {
    return ['- No assertion results were reported.']
  }

  return report.result.assertionResults.map((result) => {
    return `- [${result.status === 'passed' ? 'x' : ' '}] \`${result.assertion}\` (${result.status}) ${result.summary}`
  })
}

const renderFindings = ({
  report
}: {
  report: RunReport
}): string[] => {
  if (report.result.findings.length === 0) {
    return ['- No findings reported.']
  }

  return report.result.findings.flatMap((finding) => [
    `- ${finding.severity.toUpperCase()}: ${finding.title}`,
    `  ${finding.description}`,
    `  Steps: ${finding.reproductionSteps.join(' -> ')}`,
    ...(finding.evidence?.screenshot ? [`  Screenshot: ${finding.evidence.screenshot}`] : []),
    ...(finding.evidence?.networkLog ? [`  Network log: ${finding.evidence.networkLog}`] : [])
  ])
}

export const renderMarkdownReport = ({
  report
}: {
  report: RunReport
}): string => {
  return [
    '# BugScrub run report',
    '',
    '## Status summary',
    `- Run ID: \`${report.runId}\``,
    `- Workflow: \`${report.workflow.name}\``,
    `- Agent: \`${report.agent}\``,
    `- Status: \`${report.result.status}\``,
    `- Duration: ${report.result.durationMs}ms`,
    '',
    '## Assertion results',
    ...renderAssertionChecklist({ report }),
    '',
    '## Findings',
    ...renderFindings({ report }),
    '',
    '## Evidence summary',
    `- Screenshots: ${report.result.evidence.screenshots.join(', ') || 'none'}`,
    `- Network logs: ${report.result.evidence.networkLogs.join(', ') || 'none'}`,
    '',
    '## Transcript',
    report.result.transcriptPath
      ? `<details><summary>Agent transcript</summary>\n\n${report.result.transcriptPath}\n\n</details>`
      : 'No transcript recorded.',
    ''
  ].join('\n')
}
