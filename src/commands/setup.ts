import { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CliError } from '../utils/errors.js'
import { fileExists, writeTextFile } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

const LOCAL_DEV_BLOCK_START = '# >>> bugscrub local dev >>>'
const LOCAL_DEV_BLOCK_END = '# <<< bugscrub local dev <<<'
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const resolveLocalCliEntryPath = ({
  projectRoot = PROJECT_ROOT
}: {
  projectRoot?: string
} = {}): string => {
  return resolve(projectRoot, 'dist', 'bugscrub')
}

const buildShellSetupBlock = ({
  cliEntryPath
}: {
  cliEntryPath: string
}): string => {
  return [
    LOCAL_DEV_BLOCK_START,
    'bugscrub() {',
    `  node "${cliEntryPath}" "$@"`,
    '}',
    LOCAL_DEV_BLOCK_END
  ].join('\n')
}

const replaceOrAppendShellSetupBlock = ({
  existingContents,
  setupBlock
}: {
  existingContents: string
  setupBlock: string
}): string => {
  const blockPattern = new RegExp(
    `${LOCAL_DEV_BLOCK_START}[\\s\\S]*?${LOCAL_DEV_BLOCK_END}\\n?`,
    'm'
  )

  if (blockPattern.test(existingContents)) {
    return existingContents.replace(blockPattern, `${setupBlock}\n`)
  }

  const normalized = existingContents.trimEnd()

  if (normalized.length === 0) {
    return `${setupBlock}\n`
  }

  return `${normalized}\n\n${setupBlock}\n`
}

export const runSetupCommand = async ({
  projectRoot,
  shellRcFile
}: {
  projectRoot?: string
  shellRcFile: string
}): Promise<void> => {
  const rcFilePath = resolve(shellRcFile)
  const cliEntryPath = resolveLocalCliEntryPath({
    ...(projectRoot ? { projectRoot } : {})
  })

  if (
    !(await fileExists({
      path: cliEntryPath
    }))
  ) {
    throw new CliError({
      message: [
        `Built CLI not found at ${cliEntryPath}.`,
        'Run `pnpm build` before running `bugscrub setup`.'
      ].join('\n'),
      exitCode: 1
    })
  }

  const existingContents = (await fileExists({ path: rcFilePath }))
    ? await readFile(rcFilePath, 'utf8')
    : ''
  const nextContents = replaceOrAppendShellSetupBlock({
    existingContents,
    setupBlock: buildShellSetupBlock({
      cliEntryPath
    })
  })

  await writeTextFile({
    path: rcFilePath,
    contents: nextContents
  })

  logger.success(
    [
      `Updated ${rcFilePath} with a local BugScrub shell function.`,
      `Run \`source ${rcFilePath}\` to load it in your current shell.`
    ].join('\n')
  )
}

export const registerSetupCommand = (program: Command): void => {
  program
    .command('setup')
    .description('Add a local-dev `bugscrub` shell function to a shell rc file.')
    .argument('<shell-rc-file>', 'Path to your shell rc file, for example ~/.zshrc.')
    .action(async (shellRcFile: string) => {
      await runSetupCommand({
        shellRcFile
      })
    })
}

export const setupCommandInternals = {
  buildShellSetupBlock,
  replaceOrAppendShellSetupBlock,
  LOCAL_DEV_BLOCK_END,
  LOCAL_DEV_BLOCK_START,
  PROJECT_ROOT,
  resolveLocalCliEntryPath
}
