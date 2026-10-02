import { describe, expect, it } from 'vitest'

import { messageFor, toAiError } from './errors'

function failure(body: unknown) {
  return { message: 'Edge Function returned a non-2xx status code', context: { json: async () => body } }
}

describe('toAiError', () => {
  it('says there is no key when the function answers no_key', async () => {
    const error = await toAiError(failure({ error: 'No API key saved.', code: 'no_key' }))
    expect(error.code).toBe('no_key')
    expect(error.message).toMatch(/add your anthropic key in setup/i)
  })

  it('says the key was rejected for invalid_key', async () => {
    const error = await toAiError(failure({ error: 'Anthropic rejected this API key.', code: 'invalid_key' }))
    expect(error.code).toBe('invalid_key')
    expect(error.message).toMatch(/rejected/i)
  })

  it('names the wait for rate_limited when the function gave one', async () => {
    const error = await toAiError(failure({ error: 'x', code: 'rate_limited', retry_after_seconds: 30 }))
    expect(error.code).toBe('rate_limited')
    expect(error.message).toMatch(/30 seconds/)
  })

  it('still reads a rate limit with no wait given', () => {
    expect(messageFor('rate_limited', null, null)).toMatch(/wait a minute/i)
  })

  it("passes the function's own text through when there is no code", async () => {
    const error = await toAiError(failure({ error: 'Invalid or expired session.' }))
    expect(error.code).toBeNull()
    expect(error.message).toBe('Invalid or expired session.')
  })

  it('ignores a code it does not know', async () => {
    const error = await toAiError(failure({ error: 'boom', code: 'surprise' }))
    expect(error.code).toBeNull()
    expect(error.message).toBe('boom')
  })

  it('falls back to the generic message when the body is unreadable', async () => {
    const error = await toAiError({
      message: 'Edge Function returned a non-2xx status code',
      context: {
        json: async () => {
          throw new Error('not json')
        },
      },
    })
    expect(error.message).toBe('Edge Function returned a non-2xx status code')
  })
})
