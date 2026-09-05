// The server-side parser.
//
// SPEC section 7: a Supabase Edge Function calls the model API, so the key is a
// server secret and never reaches the browser. It requests structured JSON
// against a strict schema, with instructions to return null for anything absent
// and never to infer, and every extracted field must come back with a
// source_quote which the function then checks against the uploaded text.
//
// The function itself is supabase/functions/parse-campaign (contract in
// docs/EDGE_FUNCTION.md). Being able to reach a Supabase project (the client
// is configured) is not the same fact as the function actually being deployed
// there with a model API key secret set - the project can be live for sync
// long before that function exists. isAvailable() therefore requires both: a
// configured client, and VITE_PARSE_CAMPAIGN_DEPLOYED set once the function
// has actually been deployed and smoke-tested. Flip that flag, not this file,
// when it goes live - a false "available" would send a real request to a
// function that isn't there and surface as a confusing failure instead of the
// honest "paste the JSON instead" path.

import { getSupabaseClient } from '../sync/auth'
import {
  ParseError,
  ParserUnavailableError,
  type CampaignParser,
  type ParseInput,
  type ParseResult,
} from './types'

/** The prompt contract the Edge Function has to hold up, kept next to the stub
 *  so it is written down before it is written. */
export const EDGE_FUNCTION_CONTRACT = {
  /** Return null for anything not present. Never infer, never fill a gap. */
  returnNullWhenAbsent: true,
  /** Every extracted field carries the exact substring it came from. */
  requireSourceQuote: true,
  /** The function verifies each quote against the uploaded text and blanks any
   *  field whose quote it cannot find - see verifyQuotes, which is the same
   *  check, running client-side until the function exists. */
  verifyQuotesServerSide: true,
  /** Fields no document contains are never attempted. */
  neverAttempt: ['handles', 'setup type', 'per-stage minutes', 'daily quota'],
} as const

export class EdgeFunctionParser implements CampaignParser {
  readonly name = 'Server parser'

  isAvailable(): boolean {
    const deployed = import.meta.env.VITE_PARSE_CAMPAIGN_DEPLOYED === 'true'
    return deployed && getSupabaseClient() !== null
  }

  // async for the same reason as PastedJsonParser: every failure reaches the
  // caller as a rejection, never as a synchronous throw from a Promise-shaped
  // call.
  async parse(input: ParseInput): Promise<ParseResult> {
    const client = getSupabaseClient()
    if (!client) {
      throw new ParserUnavailableError(
        'The server parser is not configured. Paste the JSON instead - the drop box shows the shape it needs.',
      )
    }

    const { data, error } = await client.functions.invoke('parse-campaign', {
      body: { briefText: input.briefText, contractText: input.contractText },
    })

    if (error) {
      throw new ParseError(`The server parser failed: ${error.message}`)
    }
    return data as ParseResult
  }
}
