// The server-side parser. Not deployed.
//
// SPEC section 7: a Supabase Edge Function calls the model API, so the key is a
// server secret and never reaches the browser. It requests structured JSON
// against a strict schema, with instructions to return null for anything absent
// and never to infer, and every extracted field must come back with a
// source_quote which the function then checks against the uploaded text.
//
// Supabase is not provisioned, so this stub exists to hold the shape of that
// call and to fail loudly and specifically rather than silently doing nothing.
// The interface is what matters now: when the function is deployed, this class
// gets a body and nothing above it changes.

import {
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
    // There is no project to call. This stays false until Supabase is
    // provisioned and the function is deployed in phase 9.
    return false
  }

  // async for the same reason as PastedJsonParser: every failure reaches the
  // caller as a rejection, never as a synchronous throw from a Promise-shaped
  // call.
  async parse(_input: ParseInput): Promise<ParseResult> {
    throw new ParserUnavailableError(
      'The server parser is not deployed yet. Paste the JSON instead - the drop box shows the shape it needs.',
    )
  }
}
