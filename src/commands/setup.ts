import { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { CliError } from '../utils/errors.js'
import { fileExists, writeTextFile } from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import { resolveInstalledPackageRoot } from '../utils/package-root.js'

const LOCAL_DEV_BLOCK_START = '# >>> bugscrub local dev >>>'
const LOCAL_DEV_BLOCK_END = '# <<< bugscrub local dev <<<'

const resolveLocalCliEntryPath = ({
  packageRoot
}: {
  packageRoot: string
}): string => {
  return resolve(packageRoot, 'dist', 'bugscrub')
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
  packageRoot,
  shellRcFile
}: {
  packageRoot?: string
  shellRcFile: string
}): Promise<void> => {
  const rcFilePath = resolve(shellRcFile)
  const resolvedPackageRoot =
    packageRoot ??
    await resolveInstalledPackageRoot({
      metaUrl: import.meta.url
    })
  const cliEntryPath = resolveLocalCliEntryPath({
    packageRoot: resolvedPackageRoot
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
  resolveLocalCliEntryPath
}
