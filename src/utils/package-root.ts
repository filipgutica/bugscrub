import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fileExists } from './fs.js'

export const resolveInstalledPackageRoot = async ({
  metaUrl
}: {
  metaUrl: string
}): Promise<string> => {
  let currentDirectory = dirname(fileURLToPath(metaUrl))

  while (true) {
    if (
      await fileExists({
        path: join(currentDirectory, 'package.json')
      })
    ) {
      return currentDirectory
    }

    const parentDirectory = dirname(currentDirectory)

    if (parentDirectory === currentDirectory) {
      throw new Error(`Could not resolve an installed package root from ${metaUrl}.`)
    }

    currentDirectory = parentDirectory
  }
}
