import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const getBugScrubHome = (): string => {
  const override = process.env.BUGSCRUB_HOME

  if (override) {
    return resolve(override)
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME

  if (xdgConfigHome) {
    return resolve(xdgConfigHome, 'bugscrub')
  }

  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Application Support', 'bugscrub')
  }

  return resolve(homedir(), '.config', 'bugscrub')
}

export const getRepoPaths = ({ cwd }: { cwd: string }) => {
  const root = resolve(cwd)
  const bugscrubDir = join(root, '.bugscrub')

  return {
    root,
    bugscrubDir,
    configPath: join(bugscrubDir, 'bugscrub.config.yaml'),
    workflowsDir: join(bugscrubDir, 'workflows'),
    surfacesDir: join(bugscrubDir, 'surfaces'),
    reportsDir: join(bugscrubDir, 'reports'),
    debugDir: join(bugscrubDir, 'debug')
  }
}

export const getInstalledSchemaDir = (): string => {
  return resolve(fileURLToPath(new URL('../../schemas-json', import.meta.url)))
}
