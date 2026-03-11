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

const AUTHORING_GUARDRAILS = [
  '- Do not run `bugscrub init`, `bugscrub discover`, `bugscrub generate`, or `bugscrub run` from inside this authoring task.',
  '- Use `bugscrub schema <type>` when you need the exact shipped schema for config, workflow, surface, capability, assertion, or signal files.',
  '- Use `bugscrub validate` to check the files you authored and fix any reported issues before finishing.',
  '- Stay within the selected package and its `.bugscrub/` workspace; do not inspect or modify unrelated tools, parent directories, or sibling directories.'
] as const

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
    ...AUTHORING_GUARDRAILS,
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
    ...AUTHORING_GUARDRAILS,
    '',
    `Existing surfaces: ${existingSurfaces.join(', ') || 'none'}`,
    `Existing workflows: ${existingWorkflows.join(', ') || 'none'}`,
    '',
    ...formatRepoContext({
      context
    })
  ].join('\n')
}
