import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { getJsonSchemaByType, schemaTypes } from '../src/schemas/index.js'

const outputDir = resolve(process.cwd(), 'schemas-json')

await mkdir(outputDir, { recursive: true })

for (const schemaType of schemaTypes) {
  const outputPath = join(outputDir, `${schemaType}.schema.json`)
  const contents = JSON.stringify(
    getJsonSchemaByType({ type: schemaType }),
    null,
    2
  )

  await writeFile(outputPath, `${contents}\n`, 'utf8')
}
