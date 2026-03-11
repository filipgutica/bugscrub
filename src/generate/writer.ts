import { join } from 'node:path'

import { workflowSchema } from '../schemas/workflow.schema.js'
import { fileExists, writeTextFile } from '../utils/fs.js'
import { stringifyYaml } from '../utils/yaml.js'
import { CliError } from '../utils/errors.js'
import type { DraftWorkflow } from './common.js'

const renderComments = ({
  comments
}: {
  comments: string[]
}): string => {
  return comments.map((comment) => `# ${comment}`).join('\n')
}

export const renderDraftWorkflow = ({
  draft
}: {
  draft: DraftWorkflow
}): string => {
  workflowSchema.parse(draft.workflow)

  return `${renderComments({
    comments: draft.comments
  })}\n\n${stringifyYaml(draft.workflow).trimEnd()}\n`
}

export const getDraftOutputPath = ({
  cwd,
  draft,
  output
}: {
  cwd: string
  draft: DraftWorkflow
  output?: string
}): string => {
  return output ? join(cwd, output) : join(cwd, '.bugscrub', 'workflows', draft.fileName)
}

export const writeDrafts = async ({
  cwd,
  drafts,
  force,
  output
}: {
  cwd: string
  drafts: DraftWorkflow[]
  force: boolean
  output?: string
}): Promise<string[]> => {
  if (output && drafts.length !== 1) {
    throw new CliError({
      message: '`--output` can only be used when generation produces a single workflow draft.',
      exitCode: 2
    })
  }

  const targets = drafts.map((draft) => ({
    path: getDraftOutputPath({
      cwd,
      draft,
      ...(output ? { output } : {})
    }),
    source: renderDraftWorkflow({
      draft
    })
  }))

  if (!force) {
    for (const target of targets) {
      if (await fileExists({ path: target.path })) {
        throw new CliError({
          message: `Refusing to overwrite existing draft at ${target.path}. Re-run with --force.`,
          exitCode: 1
        })
      }
    }
  }

  await Promise.all(
    targets.map((target) =>
      writeTextFile({
        path: target.path,
        contents: target.source
      })
    )
  )

  return targets.map((target) => target.path)
}
