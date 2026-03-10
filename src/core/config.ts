import { bugScrubConfigSchema } from '../schemas/config.schema.js'
import type { BugScrubConfig } from '../types/index.js'
import { ValidationError } from '../utils/errors.js'
import { readTextFile } from '../utils/fs.js'
import { parseYaml } from '../utils/yaml.js'
import { getRepoPaths } from './paths.js'

const formatIssues = ({
  prefix,
  issues
}: {
  prefix: string
  issues: { path: (string | number)[]; message: string }[]
}) => {
  return issues.map(({ message, path }) => {
    const formattedPath =
      path.length === 0
        ? prefix
        : `${prefix}.${path.map((segment) => String(segment)).join('.')}`

    return `${formattedPath}: ${message}`
  })
}

export const loadBugScrubConfig = async ({
  cwd
}: {
  cwd: string
}): Promise<BugScrubConfig> => {
  const { configPath } = getRepoPaths({ cwd })
  const rawConfig = await readTextFile({ path: configPath })
  const parsed = parseYaml<unknown>(rawConfig)
  const result = bugScrubConfigSchema.safeParse(parsed)

  if (!result.success) {
    throw new ValidationError({
      message: `Invalid BugScrub config at ${configPath}.`,
      details: formatIssues({
        prefix: 'bugscrub.config',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map((segment) => String(segment)),
          message: issue.message
        }))
      })
    })
  }

  return result.data
}
