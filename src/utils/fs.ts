import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const fileExists = async ({
  path
}: {
  path: string
}): Promise<boolean> => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export const ensureDir = async ({
  path
}: {
  path: string
}): Promise<void> => {
  await mkdir(path, { recursive: true })
}

export const readTextFile = async ({
  path
}: {
  path: string
}): Promise<string> => {
  return readFile(path, 'utf8')
}

export const writeTextFile = async ({
  path,
  contents
}: {
  path: string
  contents: string
}): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}
