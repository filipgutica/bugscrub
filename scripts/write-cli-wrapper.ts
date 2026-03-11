import { chmod, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const outputPath = resolve(process.cwd(), 'dist', 'bugscrub')

const contents = [
  '#!/usr/bin/env node',
  "import { CliError } from './utils/errors.js'",
  "import { runCli } from './index.js'",
  "import { logger } from './utils/logger.js'",
  '',
  "runCli().catch((error) => {",
  '  if (error instanceof CliError) {',
  '    logger.error(error.message)',
  '    process.exitCode = error.exitCode',
  '    return',
  '  }',
  '',
  '  logger.error(error instanceof Error ? error.message : String(error))',
  '  process.exitCode = 1',
  '})',
  ''
].join('\n')

await writeFile(outputPath, contents, 'utf8')
await chmod(outputPath, 0o755)

process.stdout.write(`${join('dist', 'bugscrub')}\n`)
