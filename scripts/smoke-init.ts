import { spawn } from 'node:child_process'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type SmokeInitOptions = {
  cwdSubdir: string | undefined
  editor: 'vscode' | undefined
  fixture: string
  write: boolean
}

const parseArgs = ({ args }: { args: string[] }): SmokeInitOptions => {
  const options: SmokeInitOptions = {
    cwdSubdir: undefined,
    editor: 'vscode',
    fixture: 'simple-nextjs',
    write: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === '--write') {
      options.write = true
      continue
    }

    if (argument === '--no-editor') {
      options.editor = undefined
      continue
    }

    if (argument === '--fixture') {
      options.fixture = args[index + 1] ?? options.fixture
      index += 1
      continue
    }

    if (argument === '--cwd-subdir') {
      options.cwdSubdir = args[index + 1] ?? options.cwdSubdir
      index += 1
      continue
    }

    throw new Error(
      `Unknown argument "${argument}". Supported flags: --fixture <name>, --cwd-subdir <path>, --write, --no-editor.`
    )
  }

  return options
}

const run = async (): Promise<void> => {
  const options = parseArgs({
    args: process.argv.slice(2)
  })
  const repoRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
  const fixturesRoot = join(repoRoot, 'tests', 'fixtures', 'repos')
  const tempRoot = await mkdtemp(join(tmpdir(), 'bugscrub-init-smoke-'))
  const fixturePath = join(fixturesRoot, options.fixture)
  const copiedRepoPath = join(tempRoot, options.fixture)
  const tsxImportPath = fileURLToPath(import.meta.resolve('tsx'))
  const commandCwd =
    options.cwdSubdir === undefined
      ? copiedRepoPath
      : join(copiedRepoPath, options.cwdSubdir)

  await cp(fixturePath, copiedRepoPath, { recursive: true })

  process.stdout.write(`Smoke repo: ${copiedRepoPath}\n`)
  process.stdout.write(`Command cwd: ${commandCwd}\n`)

  const commandArgs = [
    '--import',
    tsxImportPath,
    join(repoRoot, 'src', 'index.ts'),
    'init'
  ]

  if (!options.write) {
    commandArgs.push('--dry-run')
  }

  if (options.editor) {
    commandArgs.push('--editor', options.editor)
  }

  const child = spawn(process.execPath, commandArgs, {
    cwd: commandCwd,
    stdio: 'inherit'
  })

  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolveExitCode(code ?? 1))
  })

  if (exitCode !== 0) {
    process.exitCode = exitCode
    return
  }

  process.stdout.write(
    `Init smoke ${options.write ? 'completed' : 'previewed'} successfully.\n`
  )
}

await run()
