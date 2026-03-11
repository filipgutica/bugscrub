import { spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runCommand = async ({
  args,
  command,
  cwd,
  env = process.env
}: {
  args: string[]
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
}): Promise<void> => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit'
  })

  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolveExitCode(code ?? 1))
  })

  if (exitCode !== 0) {
    process.exitCode = exitCode
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${exitCode}.`)
  }
}

const stripClaudeEnv = ({
  env
}: {
  env: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv => {
  const nextEnv = {
    ...env
  }

  for (const key of Object.keys(nextEnv)) {
    if (key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_CODE_')) {
      delete nextEnv[key]
    }
  }

  return nextEnv
}

const run = async (): Promise<void> => {
  const repoRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
  const sandboxRoot = join(repoRoot, 'sandbox')
  const sandboxAppRoot = join(sandboxRoot, 'vue-rbac-app')
  const codexAuthRoot = join(homedir(), '.codex')
  const dockerConfigRoot = join(homedir(), '.docker')
  const tempHomeRoot = await mkdtemp(join(tmpdir(), 'bugscrub-codex-home-'))
  const tempCodexHome = join(tempHomeRoot, '.codex')
  const tempXdgConfigHome = join(tempHomeRoot, '.config')

  process.stdout.write(`Repo root: ${repoRoot}\n`)
  process.stdout.write(`Sandbox app: ${sandboxAppRoot}\n`)

  try {
    await access(join(codexAuthRoot, 'auth.json'))
  } catch {
    throw new Error(
      `Expected Codex auth at ${join(codexAuthRoot, 'auth.json')}, but it was not found.`
    )
  }

  await cp(codexAuthRoot, tempCodexHome, {
    recursive: true
  })
  await mkdir(tempXdgConfigHome, {
    recursive: true
  })

  const smokeEnv = stripClaudeEnv({
    env: {
      ...process.env,
      CODEX_HOME: tempCodexHome,
      DOCKER_CONFIG: dockerConfigRoot,
      HOME: tempHomeRoot,
      XDG_CONFIG_HOME: tempXdgConfigHome
    }
  })

  try {
    await runCommand({
      args: ['build'],
      command: 'pnpm',
      cwd: repoRoot
    })
    await runCommand({
      args: ['docker:build-agent'],
      command: 'pnpm',
      cwd: repoRoot
    })

    await rm(join(sandboxAppRoot, '.bugscrub'), {
      force: true,
      recursive: true
    })

    const sandboxEntries = await readdir(sandboxRoot)
    await Promise.all(
      sandboxEntries
        .filter((entry) => entry.startsWith('.bugscrub-container-'))
        .map((entry) =>
          rm(join(sandboxRoot, entry), {
            force: true,
            recursive: true
          })
        )
    )

    await runCommand({
      args: ['init'],
      command: join(repoRoot, 'dist', 'bugscrub'),
      cwd: sandboxAppRoot,
      env: smokeEnv
    })
  } finally {
    await rm(tempHomeRoot, {
      force: true,
      recursive: true
    })
  }
}

await run()
