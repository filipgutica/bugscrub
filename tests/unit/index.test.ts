import { describe, expect, it } from 'vitest'

import { buildCli } from '../../src/index.js'

describe('buildCli', () => {
  it('registers the planned top-level commands', () => {
    const cli = buildCli()

    expect(cli.commands.map((command) => command.name())).toEqual([
      'init',
      'discover',
      'validate',
      'generate',
      'run',
      'schema'
    ])
  })
})
