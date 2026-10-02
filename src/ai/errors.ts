// Turning an Edge Function failure into a sentence he can act on.
//
// supabase-js reports every non-2xx as "Edge Function returned a non-2xx
// status code" and keeps the response on `error.context`. The functions answer
// `{ error, code }` (supabase/functions/_shared/claude.ts); the code picks the
// message, so "no key", "bad key" and "slow down" never read alike.

export type AiErrorCode = 'no_key' | 'invalid_key' | 'rate_limited' | 'model_error'

export class AiError extends Error {
  readonly code: AiErrorCode | null
  constructor(message: string, code: AiErrorCode | null = null) {
    super(message)
    this.name = 'AiError'
    this.code = code
  }
}

interface FunctionFailure {
  error?: unknown
  code?: unknown
  retry_after_seconds?: unknown
}

const CODES: readonly string[] = ['no_key', 'invalid_key', 'rate_limited', 'model_error']

/** What to tell him for a given failure. `server` is the function's own text,
 *  used when there is no code to speak of (a session problem, a bad request). */
export function messageFor(code: AiErrorCode | null, server: string | null, retryAfter: number | null): string {
  switch (code) {
    case 'no_key':
      return 'No API key saved. Add your Anthropic key in Setup first.'
    case 'invalid_key':
      return 'Your saved API key was rejected. Paste a working one in Setup.'
    case 'rate_limited':
      return retryAfter !== null
        ? `Your API key is being rate limited. Try again in about ${retryAfter} seconds.`
        : 'Your API key is being rate limited. Wait a minute and try again.'
    default:
      return server ?? 'The request failed.'
  }
}

/** Reads the function's `{ error, code }` body off a supabase-js error. */
export async function toAiError(error: { message: string; context?: unknown }): Promise<AiError> {
  const context = error.context as { json?: () => Promise<unknown> } | undefined
  try {
    const body = (await context?.json?.()) as FunctionFailure | undefined
    if (body) {
      const code = typeof body.code === 'string' && CODES.includes(body.code) ? (body.code as AiErrorCode) : null
      const server = typeof body.error === 'string' ? body.error : null
      const retry = typeof body.retry_after_seconds === 'number' ? body.retry_after_seconds : null
      return new AiError(messageFor(code, server, retry), code)
    }
  } catch {
    /* no readable body - fall back to the generic message */
  }
  return new AiError(error.message)
}
