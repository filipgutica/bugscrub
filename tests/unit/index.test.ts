import { describe, expect, it } from 'vitest'

import { buildCli } from '../../src/index.js'

describe('buildCli', () => {
  it('registers the planned top-level commands', () => {
    const cli = buildCli()

    expect(cli.commands.map((command) => command.name())).toEqual([
      'init',
      'setup',
      'setup-runtime',
      'discover',
      'validate',
      'generate',
      'run',
      'schema'
    ])
  })

  it('registers the global workspace filter option', () => {
    const cli = buildCli()

    expect(cli.options.some((option) => option.long === '--filter')).toBe(true)
  })
})
