import { getJsonSchemaByType } from '../../schemas/index.js'
import type {
  BaseRunContext,
  ResolvedAssertion,
  ResolvedCapability,
  ResolvedIdentity,
  ResolvedTaskStep
} from '../agent/types.js'
import { buildRuntimeProbeUrl, isLocalBaseUrl } from '../local-runtime.js'

const formatIdentity = ({
  identity
}: {
  identity: ResolvedIdentity
}): string => {
  if (identity.auth.type === 'none') {
    return `${identity.name}: no authentication required`
  }

  if (identity.auth.type === 'env') {
    return `${identity.name}: username in \`${identity.auth.usernameEnvVar}\`, password in \`${identity.auth.passwordEnvVar}\``
  }

  return `${identity.name}: token in \`${identity.auth.tokenEnvVar}\``
}

const formatSignalList = ({
  signals
}: {
  signals: Array<{ description: string; namespacedName: string }>
}): string[] => {
  return signals.map((signal) => `  - \`${signal.namespacedName}\`: ${signal.description}`)
}

const formatCapability = ({
  capability,
  identity,
  index,
  kind,
  previousIdentity
}: {
  capability: ResolvedCapability
  identity: ResolvedIdentity
  index: number
  kind: 'setup' | 'task'
  previousIdentity: ResolvedIdentity | undefined
}): string[] => {
  const lines = [
    `${index + 1}. ${kind === 'setup' ? 'Setup' : 'Task'} \`${capability.namespacedName}\` as \`${identity.name}\``,
    `   Description: ${capability.description}`
  ]

  if (previousIdentity && previousIdentity.name !== identity.name) {
    lines.push(`   Session switch: change the active session from \`${previousIdentity.name}\` to \`${identity.name}\`.`)
  }

  if (capability.preconditions.length > 0) {
    lines.push(`   Preconditions: ${capability.preconditions.join('; ')}`)
  }

  if (capability.guidance.length > 0) {
    lines.push(`   Guidance:`)
    lines.push(...capability.guidance.map((guidance) => `   - ${guidance}`))
  }

  if (capability.successSignals.length > 0) {
    lines.push('   Success signals:')
    lines.push(...formatSignalList({ signals: capability.successSignals }).map((line) => `   ${line.trimStart()}`))
  }

  if (capability.failureSignals.length > 0) {
    lines.push('   Failure signals:')
    lines.push(...formatSignalList({ signals: capability.failureSignals }).map((line) => `   ${line.trimStart()}`))
  }

  return lines
}

const formatAssertion = ({
  assertion
}: {
  assertion: ResolvedAssertion
}): string => {
  const matcher =
    assertion.kind === 'dom_presence' || assertion.kind === 'dom_absence'
      ? `test_id=${assertion.match.test_id}`
      : assertion.kind === 'text_visible'
        ? `text=${assertion.match.text}`
        : assertion.kind === 'url_match'
          ? `pathname=${assertion.match.pathname}`
          : `urlContains=${assertion.match.urlContains}, status=${assertion.match.status}`

  return `- \`${assertion.namespacedName}\`: ${assertion.description} (${assertion.kind}; ${matcher})`
}

export const roleSection = (): string => {
  return [
    '## Role framing',
    'You are an expert exploratory tester operating within the workflow boundaries defined below.',
    'Do not invent capabilities or assertions that are not present in this prompt.'
  ].join('\n')
}

export const targetSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  return [
    '## Target application',
    `- Project: \`${context.config.project}\``,
    `- Base URL: ${context.environment.baseUrl}`,
    `- Surface: \`${context.selectedSurface.surface.name}\``,
    `- Routes: ${context.selectedSurface.surface.routes.join(', ') || '(none)'}`,
    `- Workflow: \`${context.workflow.name}\``
  ].join('\n')
}

export const authenticationSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  return [
    '## Authentication',
    `- Environment: \`${context.environment.name}\``,
    `- Default identity: \`${context.environment.defaultIdentity.name}\``,
    ...context.environment.identities.map((identity) => `- ${formatIdentity({ identity })}`)
  ].join('\n')
}

export const runtimePreparationSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  const lines = ['## Runtime preparation']

  if (isLocalBaseUrl({ baseUrl: context.environment.baseUrl })) {
    if (context.environment.localRuntime) {
      lines.push(
        `- BugScrub starts the configured local runtime in-container before exploration and waits for \`${buildRuntimeProbeUrl({
          baseUrl: context.environment.baseUrl,
          readyPath: context.environment.localRuntime.readyPath
        })}\` to become reachable.`,
        `- BugScrub already verified that \`${context.environment.baseUrl}\` is reachable in the runtime container. Start exploration from that URL instead of re-checking it with separate shell probes.`,
        '- If the local app later becomes unavailable, stop and report the runtime failure with the captured startup logs.'
      )
    } else {
      lines.push(
        `- Before opening the browser, verify that \`${context.environment.baseUrl}\` is reachable.`,
        '- If the local app is unavailable, stop and report that the repo dev server is not running instead of continuing blindly.'
      )
    }
  } else {
    lines.push(
      `- Verify that \`${context.environment.baseUrl}\` is reachable before spending time on browser exploration.`,
      '- If the target is unavailable, fail the run with a clear explanation instead of continuing blindly.'
    )
  }

  return lines.join('\n')
}

export const sessionSetupSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  const lines = ['## Session setup']
  let previousIdentity: ResolvedIdentity | undefined

  for (const [index, step] of context.setup.entries()) {
    lines.push(
      ...formatCapability({
        capability: step.capability,
        identity: step.identity,
        index,
        kind: 'setup',
        previousIdentity
      })
    )
    previousIdentity = step.identity
  }

  if (context.setup.length === 0) {
    lines.push('- No explicit setup steps.')
  }

  return lines.join('\n')
}

export const explorationSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  const lines = ['## Exploration tasks']
  let previousIdentity: ResolvedIdentity | undefined =
    context.setup.length > 0 ? context.setup.at(-1)?.identity : undefined

  for (const [index, task] of context.tasks.entries()) {
    lines.push(
      ...formatCapability({
        capability: task.capability,
        identity: task.identity,
        index,
        kind: 'task',
        previousIdentity
      })
    )
    lines.push(`   Iterations: minimum ${task.min}, maximum ${task.max}.`)
    previousIdentity = task.identity
  }

  return lines.join('\n')
}

export const hardAssertionsSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  if (context.hardAssertions.length === 0) {
    return [
      '## Hard assertions checklist',
      'This workflow has no hard assertions.',
      'Set `assertionResults` to an empty array in the final JSON output.',
      'Do not put capability names, task names, or free-form checks into `assertionResults`.'
    ].join('\n')
  }

  return [
    '## Hard assertions checklist',
    'You must verify every assertion and include one `assertionResults` entry per assertion in the final JSON output.',
    ...context.hardAssertions.map((assertion) => formatAssertion({ assertion }))
  ].join('\n')
}

export const evidenceSection = ({
  context
}: {
  context: BaseRunContext
}): string => {
  return [
    '## Evidence instructions',
    `- Write screenshots under \`${context.artifacts.screenshotsDir}\` when screenshots are enabled.`,
    `- Write network logs under \`${context.artifacts.networkDir}\` when network logs are enabled.`,
    '- Include written evidence file paths in the `evidence` fields of the final JSON output.',
    `- Workflow evidence settings: screenshots=${context.workflow.evidence.screenshots}, network_logs=${context.workflow.evidence.network_logs}`
  ].join('\n')
}

export const outputFormatSection = (): string => {
  return [
    '## Output format',
    'Your final response must be a valid JSON object matching this RunResult schema exactly.',
    '```json',
    JSON.stringify(getJsonSchemaByType({ type: 'run-result' }), null, 2),
    '```'
  ].join('\n')
}
