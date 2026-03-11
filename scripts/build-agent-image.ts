import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const imageName = process.env.BUGSCRUB_CONTAINER_IMAGE ?? 'bugscrub-agent:latest'
const dockerfilePath = fileURLToPath(new URL('../docker/bugscrub-agent.Dockerfile', import.meta.url))

const buildxCheck = spawnSync('docker', ['buildx', 'version'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit'
})

if (buildxCheck.error) {
  throw buildxCheck.error
}

if (buildxCheck.status !== 0) {
  process.exit(buildxCheck.status ?? 1)
}

const result = spawnSync(
  'docker',
  ['buildx', 'build', '--load', '--file', dockerfilePath, '--tag', imageName, projectRoot],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
