import { describe, expect, it } from 'vitest'

import { negotiateCapabilities } from '../../../src/runner/negotiator.js'
import { CliError } from '../../../src/utils/errors.js'

describe('negotiateCapabilities', () => {
  it('accepts supported workflow requirements including dotted aliases', () => {
    expect(() =>
      negotiateCapabilities({
        capabilities: {
          browser: {
            navigation: true,
            domRead: true,
            networkObserve: true,
            screenshots: false
          },
          api: {
            httpRequests: true
          },
          auth: {
            session: true,
            token: false
          }
        },
        requires: ['browser.navigation', 'browser.dom.read', 'api.httpRequests']
      })
    ).not.toThrow()
  })

  it('fails fast when a required capability is missing', () => {
    expect(() =>
      negotiateCapabilities({
        capabilities: {
          browser: {
            navigation: true,
            domRead: false,
            networkObserve: true,
            screenshots: true
          },
          api: {
            httpRequests: true
          },
          auth: {
            session: true,
            token: true
          }
        },
        requires: ['browser.dom.read']
      })
    ).toThrowError(CliError)
  })
})
