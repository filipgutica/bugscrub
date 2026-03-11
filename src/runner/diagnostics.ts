import { ensureDir, writeTextFile } from '../utils/fs.js'
import { getRepoPaths } from '../core/paths.js'
import { toDateStamp } from '../utils/date.js'
import type { RunArtifactPaths } from './agent/types.js'

export const buildRunArtifactPaths = ({
  cwd,
  runId,
  workflowName
}: {
  cwd: string
  runId: string
  workflowName: string
}): RunArtifactPaths => {
  const repoPaths = getRepoPaths({ cwd })
  const dateStamp = toDateStamp()

  return {
    debugDir: `${repoPaths.debugDir}/${runId}`,
    networkDir: `${repoPaths.debugDir}/${runId}/network`,
    promptPath: `${repoPaths.debugDir}/${runId}/prompt.md`,
    reportJsonPath: `${repoPaths.reportsDir}/${dateStamp}-${runId}-${workflowName}.json`,
    reportMarkdownPath: `${repoPaths.reportsDir}/${dateStamp}-${runId}-${workflowName}.md`,
    responseSchemaPath: `${repoPaths.debugDir}/${runId}/run-result.schema.json`,
    screenshotsDir: `${repoPaths.debugDir}/${runId}/screenshots`,
    transcriptPath: `${repoPaths.debugDir}/${runId}/agent-transcript.jsonl`
  }
}

export const prepareRunArtifactDirectories = async ({
  artifacts
}: {
  artifacts: RunArtifactPaths
}): Promise<void> => {
  await Promise.all([
    ensureDir({ path: artifacts.debugDir }),
    ensureDir({ path: artifacts.networkDir }),
    ensureDir({ path: artifacts.screenshotsDir })
  ])
}

export const writePromptArtifact = async ({
  path,
  prompt
}: {
  path: string
  prompt: string
}): Promise<void> => {
  await writeTextFile({
    path,
    contents: prompt
  })
}

export const writeTranscriptArtifact = async ({
  path,
  transcript
}: {
  path: string
  transcript: string
}): Promise<void> => {
  await writeTextFile({
    path,
    contents: transcript.endsWith('\n') ? transcript : `${transcript}\n`
  })
}

export const writeResponseSchemaArtifact = async ({
  path,
  schema
}: {
  path: string
  schema: string
}): Promise<void> => {
  await writeTextFile({
    path,
    contents: `${schema}\n`
  })
}
