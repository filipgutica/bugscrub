import type { InitContext } from './context.js'
import type { WorkspacePackage } from './detector.js'

const formatRepoContext = ({
  context
}: {
  context: InitContext
}): string[] => {
  return [
    'Suggested repo context to review first:',
    ...context.configFiles.map((file) => `- ${file}`),
    ...context.sampleSourceFiles.slice(0, 5).map((file) => `- ${file}`),
    ...context.sampleTestFiles.slice(0, 5).map((file) => `- ${file}`)
  ]
}

export const buildInitAuthoringHandoff = ({
  context,
  selectedPackage
}: {
  context: InitContext
  selectedPackage: WorkspacePackage | undefined
}): string => {
  return [
    '# Agent handoff',
    '',
    `You are authoring BugScrub workspace files for \`${selectedPackage?.relativePath ?? '.'}\`.`,
    '',
    'Required work:',
    '- Inspect the selected package directly; do not rely only on this summary.',
    '- Replace placeholder values in `.bugscrub/bugscrub.config.yaml` where needed.',
    '- Create repo-specific surfaces under `.bugscrub/surfaces/<surface>/`.',
    '- Create repo-specific workflows under `.bugscrub/workflows/`.',
    '- Keep all generated YAML valid against the shipped BugScrub schemas.',
    '- Run `bugscrub validate` after writing files and fix any reported issues.',
    '',
    ...formatRepoContext({
      context
    })
  ].join('\n')
}

export const buildDiscoverAuthoringHandoff = ({
  context,
  existingSurfaces,
  existingWorkflows,
  selectedPackage
}: {
  context: InitContext
  existingSurfaces: string[]
  existingWorkflows: string[]
  selectedPackage: WorkspacePackage | undefined
}): string => {
  return [
    '# Discover handoff',
    '',
    `You are updating BugScrub workspace files for \`${selectedPackage?.relativePath ?? '.'}\`.`,
    '',
    'Required work:',
    '- Inspect the selected package directly; do not rely only on this summary.',
    '- Inspect the existing `.bugscrub/` workspace before editing.',
    '- Keep existing repo-specific surfaces and workflows unless they are clearly incorrect.',
    '- Author missing surfaces under `.bugscrub/surfaces/<surface>/`.',
    '- Author missing workflows under `.bugscrub/workflows/`.',
    '- Prefer filling coverage gaps over rewriting files that already exist.',
    '- Keep all generated YAML valid against the shipped BugScrub schemas.',
    '- Run `bugscrub validate` after writing files and fix any reported issues.',
    '',
    `Existing surfaces: ${existingSurfaces.join(', ') || 'none'}`,
    `Existing workflows: ${existingWorkflows.join(', ') || 'none'}`,
    '',
    ...formatRepoContext({
      context
    })
  ].join('\n')
}
