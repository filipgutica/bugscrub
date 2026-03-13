import type { InitContext } from './context.js'
import type { InitFramework, InitTestRunner, WorkspacePackage } from './detector.js'

export type InitSummaryContext = {
  context: InitContext
  dryRun: boolean
  editor: 'vscode' | undefined
  framework: InitFramework
  packageRoot: string
  selectedPackage: WorkspacePackage | undefined
  skipScan: boolean
  testRunners: InitTestRunner[]
  usesPlaceholderBaseUrl: boolean
  writtenDirectories: string[]
  writtenFiles: string[]
}

const renderListSection = ({
  items,
  title
}: {
  items: string[]
  title: string
}): string[] => {
  if (items.length === 0) {
    return [title, '- none detected', '']
  }

  return [title, ...items.map((item) => `- \`${item}\``), '']
}

export const renderInitReport = ({
  context,
  dryRun,
  editor,
  framework,
  packageRoot,
  selectedPackage,
  skipScan,
  testRunners,
  usesPlaceholderBaseUrl,
  writtenDirectories,
  writtenFiles
}: InitSummaryContext): string => {
  const lines = [
    '# BugScrub init report',
    '',
    '## Scope',
    `- Package root: \`${packageRoot}\``,
    `- Selected package: \`${selectedPackage?.relativePath ?? '.'}\``,
    `- Framework: \`${framework}\``,
    `- Test runners: ${
      testRunners.length > 0
        ? testRunners.map((runner) => `\`${runner}\``).join(', ')
        : 'none detected'
    }`,
    `- Mode: \`${dryRun ? 'dry-run' : 'write'}\``,
    `- Editor settings: \`${editor ?? 'none'}\``,
    '',
    '## Bootstrap Result',
    '- BugScrub wrote a minimal validated scaffold only.',
    skipScan
      ? '- Surface and workflow YAML files were intentionally left for a later `discover` or `generate` pass.'
      : '- Surface and workflow YAML files were intentionally left for the agent to author.',
    usesPlaceholderBaseUrl
      ? '- `local.baseUrl` is a placeholder and must be replaced before running workflows.'
      : '- `local.baseUrl` was inferred from the detected framework and can be edited if this repo uses a different local dev URL.',
    framework === 'unknown'
      ? '- `localRuntime` was omitted because BugScrub could not infer a safe app startup command for this repo.'
      : '- `localRuntime` was inferred from the detected framework and package manager and can be refined if this repo starts differently.',
    ''
  ]

  lines.push(
    ...renderListSection({
      title: '## Config Files',
      items: context.configFiles
    }),
    ...renderListSection({
      title: '## Sample Source Files',
      items: context.sampleSourceFiles
    }),
    ...renderListSection({
      title: '## Sample Test Files',
      items: context.sampleTestFiles
    })
  )

  if (context.packageJsonName) {
    lines.push('## Package Metadata', `- package.json name: \`${context.packageJsonName}\``, '')
  }

  lines.push(
    '## Next Step',
    skipScan
      ? '- Run `bugscrub discover` for agent-authored surfaces/workflows, or `bugscrub generate` to draft workflows from local evidence.'
      : '- Ask an agent to inspect this package and author `.bugscrub/surfaces/*` and `.bugscrub/workflows/*.yaml`.',
    skipScan
      ? '- Re-run `bugscrub validate` after repo-specific surfaces and workflows are added.'
      : '- Re-run `bugscrub validate` after the agent fills in the repo-specific files.',
    ''
  )

  lines.push(
    '## Files',
    ...writtenDirectories.map((directory) => `- dir: \`${directory}\``),
    ...writtenFiles.map((file) => `- file: \`${file}\``)
  )

  return `${lines.join('\n')}\n`
}

export const renderInitStdoutSummary = ({
  author,
  authorAgent,
  authoredFiles = [],
  dryRun,
  selectedPackage,
  usesPlaceholderBaseUrl,
  writtenFiles
}: {
  author: boolean
  authorAgent: string | undefined
  authoredFiles?: string[]
  dryRun: boolean
  selectedPackage: WorkspacePackage | undefined
  usesPlaceholderBaseUrl: boolean
  writtenFiles: string[]
}): string => {
  const targetLabel = selectedPackage?.relativePath ?? '.'
  const totalWrittenFiles = new Set([...writtenFiles, ...authoredFiles]).size
  const lines = [
    `BugScrub init ${dryRun ? 'previewed' : 'completed'} for ${targetLabel === '.' ? 'the current package' : targetLabel}.`,
    author
      ? `Scaffold: config, report, and agent handoff${dryRun ? ' planned for execution' : ` executed via ${authorAgent ?? 'the selected agent'}`}.`
      : 'Scaffold: config, report, and agent handoff only.',
    `Files ${dryRun ? 'planned' : 'written'}: ${totalWrittenFiles}.`
  ]

  if (usesPlaceholderBaseUrl) {
    lines.push('Replace the placeholder local.baseUrl before running workflows.')
  }

  return lines.join('\n')
}
