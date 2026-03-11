import type { RunReport } from '../runner/agent/types.js'

export const renderJsonReport = ({
  report
}: {
  report: RunReport
}): string => {
  return `${JSON.stringify(report, null, 2)}\n`
}
