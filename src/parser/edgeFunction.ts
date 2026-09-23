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
      // version 2: rules come back as { body, source_quote } rather than as
      // bare strings. A function that predates it ignores the field.
      body: { briefText: input.briefText, contractText: input.contractText, version: 2 },
    })

    if (error) {
      throw new ParseError(`The server parser failed: ${await describeError(error)}`)
    }
    return withQuotedRules(data as ParseResult)
  }
}

/** A function too old to quote its rules sends them as strings. Each is taken
 *  as its own quote, which the client's verifyQuotes then holds to the same
 *  standard as a pasted one: kept only if those words are in a document. */
function withQuotedRules(result: ParseResult): ParseResult {
  const rules = (result.rules as unknown[]).map((rule) =>
    typeof rule === 'string' ? { body: rule, source_quote: rule } : rule,
  ) as ParseResult['rules']
  const bonus_tiers = (result.bonus_tiers ?? []).map((tier) => ({
    ...tier,
    source_quote: tier.source_quote ?? null,
  }))
  return { ...result, rules, bonus_tiers }
}

/** The function's own explanation, when it gave one. supabase-js reports any
 *  non-2xx as "Edge Function returned a non-2xx status code" and keeps the
 *  body - where the function says what actually went wrong - on the error's
 *  context, so without this every failure read the same. */
async function describeError(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context as { json?: () => Promise<unknown> } | undefined
  try {
    const body = (await context?.json?.()) as { error?: unknown } | undefined
    if (body && typeof body.error === 'string') return body.error
  } catch {
    /* no readable body - fall back to the generic message */
  }
  return error.message
}
