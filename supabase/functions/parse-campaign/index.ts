// The parser Edge Function. Contract: docs/EDGE_FUNCTION.md.
//
// Calls the model server-side (the key must never reach the browser),
// requires a valid session, asks for JSON against a strict schema with a
// source_quote on every field, rule and bonus tier, then runs the vendored
// verifyQuotes against the uploaded text before returning anything - a value
// survives only if the model's own quote can still be found verbatim in the
// document it claims to come from. This function writes nothing to the
// database; it parses and returns.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { verifyQuotes } from '../_shared/verify.ts'
import {
  NEVER_PARSED_FIELDS,
  type ParseResult,
  type ParsedBonusTier,
  type ParsedField,
  type ParsedRule,
} from '../_shared/parserTypes.ts'
import { callForJson, errorResponse, jsonResponse, loadUserKey, nullable, requireUser } from '../_shared/claude.ts'
import { isOwner } from '../_shared/owner.ts'
import { MAX_PDF_BYTES, streamTranscript } from '../_shared/pdf.ts'

// Opus, not Haiku. These are PDF conversions with split tables, running
// headers and OCR noise, and every value has to come back with a quote that
// matches the text exactly - Haiku was fast at the clean template and lost
// fields on the messy ones, which then read as "not saved yet". It runs a
// couple of times a month, so accuracy is worth far more than the cost.
// Opus 5.5 rather than 5: newer, and cheaper per token. It also writes out
// the owner's PDFs (_shared/pdf.ts).
const MODEL = Deno.env.get('PARSE_CAMPAIGN_MODEL') ?? 'claude-opus-5-5'

/** The field keys the parser may return, and the only ones. A fixed list,
 *  so the same fact always lands under the same key - the app reads
 *  `disclosure` and `pay_per_video_cents` by name, and a free-form parser
 *  used to file one campaign's video length under three different keys. */
const FIELD_KEYS = {
  // From the contract - SideShift templates, parsed with high confidence.
  contract_name: 'text',
  term_commenced: 'text',
  term_effective: 'text',
  pay_per_video_cents: 'money',
  cycle_size: 'count',
  base_comp_cap: 'count',
  post_public_days: 'count',
  revision_rounds: 'count',
  payment_trigger: 'text',
  // What the contract says he owes and when he is paid. posts_per_week fills
  // the review screen's weekly box; the rest are kept as fields and read from
  // the campaign page - none of them is acted on by the app.
  posts_per_week: 'count',
  payout_timing: 'text',
  min_views_to_be_paid: 'count',
  other_requirements: 'text',
  // From either.
  platforms: 'text',
  // From the brief.
  minimum_length_seconds: 'count',
  technical_spec: 'text',
  submission_route: 'text',
  disclosure: 'text',
  hashtags: 'text',
  product_facts: 'text',
  audience: 'text',
  tone: 'text',
  structure: 'text',
} as const

type FieldKind = (typeof FIELD_KEYS)[keyof typeof FIELD_KEYS]

const DOCUMENT = { type: 'string', enum: ['brief', 'contract'] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['campaign', 'fields', 'bonus_tiers', 'rules', 'hook_brief', 'brief_is_incomplete', 'warnings'],
  properties: {
    campaign: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'company', 'approval_mode'],
      properties: {
        name: { type: 'string' },
        company: nullable({ type: 'string' }),
        approval_mode: nullable({
          type: 'string',
          enum: ['none', 'video', 'script_and_video', 'brand_scripted'],
        }),
      },
    },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'source_quote', 'from', 'note'],
        properties: {
          key: { type: 'string', enum: Object.keys(FIELD_KEYS) },
          value: { type: 'string' },
          source_quote: { type: 'string' },
          from: DOCUMENT,
          note: nullable({ type: 'string' }),
        },
      },
    },
    bonus_tiers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'threshold_views', 'payout_cents', 'view_window_days', 'source_quote', 'from'],
        properties: {
          label: { type: 'string' },
          threshold_views: { type: 'integer' },
          payout_cents: { type: 'integer' },
          view_window_days: nullable({ type: 'integer' }),
          source_quote: { type: 'string' },
          from: DOCUMENT,
        },
      },
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['body', 'source_quote', 'from'],
        properties: {
          body: { type: 'string' },
          source_quote: { type: 'string' },
          from: DOCUMENT,
        },
      },
    },
    hook_brief: nullable({ type: 'string' }),
    brief_is_incomplete: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}

const SYSTEM_PROMPT = `You read a UGC creator's brand contract and brief and pull out the facts he works from. What you return is checked mechanically: every value carries a source_quote, and any quote that cannot be found in the document it names is thrown away. A blank costs him nothing. An invented value is the worst possible outcome, because nothing downstream can tell it apart from a real one and it reaches a brand as a fact.

So: return only what the documents state. Leave a field out entirely when they do not state it - absence is the common, correct answer. Never infer, complete a pattern, or fill a gap from how such contracts usually read.

## Quoting

source_quote is the shortest contiguous span of the document that contains the value - usually 3 to 25 words - copied character for character. These documents are PDF-to-markdown conversions: tables are split across lines, headers and page numbers are interleaved, words are hyphenated at line ends, there are OCR errors. Copy all of that exactly as it appears; do not correct spelling, join hyphenated words, or tidy punctuation. Line breaks and runs of spaces do not matter. Never join two separate passages with "..." and never quote across text you skipped. If the words you need are divided by table pipes or layout characters, include those characters exactly, or quote only the cell that holds the value. from names the document the quote is in.

## Fields

Use only these keys, each at most once:

Contract (SideShift contracts are templated - these anchors recur):
- contract_name, term_commenced, term_effective: the Key Contract Information table, as written.
- pay_per_video_cents: after "Per-post compensation:", "$NN.NN per approved deliverable". Integer cents as digits: $35.00 is "3500".
- cycle_size: "A payment cycle completes when NN deliverables". Digits only.
- base_comp_cap: "maximum of NN posts per payment cycle". Digits only.
- post_public_days: "not delete, hide, or restrict it for a period of NN". Digits only.
- revision_rounds: how many rounds of revisions a video gets. Digits only.
- payment_trigger: when and how he is paid, in a sentence.
- platforms: "Required platforms:" - the platform names, comma-separated.
- posts_per_week: how many deliverables he owes per week, as a whole number, only if the documents state it as a weekly count (or as a per-week figure you can read off directly, such as "5 posts a week"). Do not work it out from a daily, monthly or cycle figure.
- payout_timing: when payment is made after posting or after a cycle completes, in a sentence.
- min_views_to_be_paid: a minimum view count a video must reach to be paid at all. Digits only. Not a bonus tier.
- other_requirements: anything the documents require of him that no other key and no never-do rule holds (reporting, links, response times), in a few plain sentences.

Brief:
- platforms, if the contract did not state them.
- minimum_length_seconds: the minimum video length. Digits only.
- technical_spec: aspect ratio, resolution, frame rate, camera requirements, in one line.
- submission_route: how a video is submitted or approved before posting.
- disclosure: the required ad disclosure, labels and tags.
- hashtags: required hashtags and handles to tag, as written.
- product_facts: what the product IS and the claims the brief permits about it, including any attribution it demands (a claim to be phrased as the company's rather than as fact).
- audience: who the videos are for. If it names several segments, give them all.
- tone: how the videos should sound - register, energy, and the phrasings or deliveries it forbids.
- structure: what the video does after the hook - the beats, in order, and any timing it fixes.

product_facts, audience, tone and structure are prose, and every brief writes them differently under different headings: a brief that never says "audience" may still say plainly who it is for. Condense into a few clear sentences; the quote must still be verbatim, but the value may be your summary of the passage you quoted.

Money is integer cents and counts are whole numbers, written as digits only - never "$35", never "thirty".

note is null unless something about the value would make a careful person pause before relying on it: the documents state it two different ways, the text around it is garbled, it only holds under a condition. Then one short sentence saying what. Where the brief and the signed contract disagree, return the contract's value and say so in the note.

## Never-do rules

Every explicit prohibition or hard requirement for the videos themselves ("never", "do not", "must", "always", "required", "no ..."), one per item, never two merged. body is the rule in a few plain words, keeping its specifics exactly - numbers, handles, hashtags, durations. source_quote is the verbatim span it came from. Suggestions, tone advice and nice-to-haves are not rules.

## Bonus tiers

Under "Bonuses (per Deliverable):", lines of "N views: $NN.NN". source_quote is that tier's own line and must contain both the view count and the payout. payout_cents is integer cents ($50.00 is 5000). view_window_days comes from "Only views accrued within NN days", or null.

## Never attempt

Handles, account emails or passwords, editing style, setup type, per-stage minutes, and the daily post quota. No document states these; anything that looks like one is a coincidence.

## hook_brief

When a brief is provided, write a working brief for the hook writer in markdown; when none is provided, return null. Output the document only, in exactly these sections in this order: ## PRODUCT, ## AUDIENCE, ## VOICE, ## STRUCTURE, ## TALKING POINTS, ## FORMATS, ## ANGLES, ## HOOK BANK, ## NEVER DO, ## GAPS.

- PRODUCT: what it is and what he may claim, with any attribution the brief demands shown as phrasing ("X says ..."), then a short "never claim" list.
- AUDIENCE, VOICE, STRUCTURE: as the brief states them. VOICE includes phrasings and deliveries it forbids. STRUCTURE is what the video does after the hook.
- TALKING POINTS: a plain list of six to eight lines, "- " each, one idea per line, twelve words or fewer, written as he would say it aloud, in the order they should come out. Slots, in order: the problem, why it happens, the turn (what the product does differently), the one concrete detail the brief permits exactly as written, the proof, the objection, why now, the stake. Skip any slot the brief does not support - fewer honest lines beat padded ones. No sub-bullets, bold, numbering, opening line or call to action. Keep a required attribution inside the line.
- FORMATS: each repeatable video shape the brief states or implies, with what it looks like and how long it runs.
- ANGLES: eight to twelve distinct storylines, one per line as "ID - FAMILY: one-sentence concept", where the ID is short (A-FROZEN), the FAMILY groups them into two or three emotional registers, and each is a genuinely different reason to stop scrolling that traces back to something the brief supports.
- HOOK BANK: hooks, openers or viral references already in the brief, grouped by format; otherwise exactly "none in the brief".
- NEVER DO: the absolute restrictions, one short imperative per line, including compliance and disclosure.
- GAPS: what he should go and ask the brand.

Work only from the documents. Never add a statistic, price, percentage, guarantee or feature that is not in them. Where the brief is silent, write "not stated in the brief" for that section instead of filling it. Do not include the pay rate, post quota, handles or logins. hook_brief is not quote-checked, so this restraint is the only protection against an invention reaching a brand.

## Damaged briefs

If the brief looks like a lossy conversion - missing section headings, scrambled tables, a cross-reference to a section that is not there - set brief_is_incomplete and say why in warnings. A missing section is a rule you cannot see, not a rule that does not exist.

warnings holds what he should know that is not attached to a single field, one short line each. It is not for narrating what you did.`

interface ModelField {
  key: keyof typeof FIELD_KEYS
  value: string
  source_quote: string
  from: 'brief' | 'contract'
  note: string | null
}

interface ModelOutput {
  campaign: ParseResult['campaign']
  fields: ModelField[]
  bonus_tiers: ParsedBonusTier[]
  rules: ParsedRule[]
  hook_brief: string | null
  brief_is_incomplete: boolean
  warnings: string[]
}

/** From the model's list into the keyed record the app works with, keeping
 *  only known keys, the first value for each, and money and counts that are
 *  really digits. A rate that came back as "$35" or "35.00" is rejected
 *  rather than converted: docs/EDGE_FUNCTION.md says to refuse dollars, not
 *  to round them, because converting could silently accept a dollar amount
 *  mistaken for cents. */
function toResult(output: ModelOutput): ParseResult {
  const fields: Record<string, ParsedField> = {}
  const warnings = [...(output.warnings ?? [])]

  for (const field of output.fields ?? []) {
    const kind: FieldKind | undefined = FIELD_KEYS[field.key]
    if (kind === undefined || field.key in fields) continue
    if ((NEVER_PARSED_FIELDS as readonly string[]).includes(field.key)) continue
    const value = String(field.value ?? '').trim()
    if (value === '') continue
    if ((kind === 'money' || kind === 'count') && !/^\d+$/.test(value)) {
      warnings.push(`${field.key.replace(/_/g, ' ')} was dropped: it came back as "${value}", not a whole number.`)
      continue
    }
    fields[field.key] = {
      value,
      source_quote: field.source_quote,
      from: field.from,
      note: field.note === null || field.note.trim() === '' ? null : field.note.trim(),
    }
  }

  return {
    campaign: output.campaign,
    fields,
    bonus_tiers: output.bonus_tiers ?? [],
    rules: (output.rules ?? []).filter((rule) => rule.body.trim() !== ''),
    hook_brief: output.hook_brief === null || output.hook_brief?.trim() === '' ? null : (output.hook_brief ?? null),
    brief_is_incomplete: output.brief_is_incomplete === true,
    warnings,
  }
}

/** The shape a client from before quoted rules expects: rules as plain
 *  strings. Only rules that passed verification are in the list by now, so
 *  an old client still never writes an unquoted rule - it simply cannot show
 *  the quote. Everything else is additive and an old client ignores it. */
function legacyShape(result: ParseResult): unknown {
  return { ...result, rules: result.rules.map((rule) => rule.body) }
}

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON: { briefText, contractText }.' }, 400)
  }

  // What this account may send. The browser asks once and offers PDF only
  // when told yes; the transcribe action below checks again regardless.
  if (body?.action === 'capabilities') {
    return jsonResponse({ pdf: isOwner(auth.userId) })
  }

  if (body?.action === 'transcribe') {
    if (!isOwner(auth.userId)) {
      return jsonResponse({ error: 'PDF reading is only on for the owner account. Paste Markdown instead.' }, 403)
    }
    const pdf = typeof body.pdf === 'string' ? body.pdf : ''
    if (pdf === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdf.slice(-64))) {
      return jsonResponse({ error: 'Send the PDF as base64: { action: "transcribe", pdf }.' }, 400)
    }
    if (Math.floor((pdf.length * 3) / 4) > MAX_PDF_BYTES) {
      return jsonResponse({ error: 'That PDF is over 15 MB. Split it, or paste the text instead.' }, 413)
    }
    try {
      return await streamTranscript({ apiKey: await loadUserKey(auth.userId), model: MODEL, pdfBase64: pdf })
    } catch (err) {
      return errorResponse(err, 'Reading the PDF failed: ')
    }
  }

  const briefText: string | null =
    typeof body?.briefText === 'string' && body.briefText.trim() !== '' ? body.briefText : null
  const contractText: string | null =
    typeof body?.contractText === 'string' && body.contractText.trim() !== '' ? body.contractText : null
  const version = Number(body?.version ?? 1)

  if (briefText === null && contractText === null) {
    return jsonResponse({ error: 'At least one of briefText or contractText is required.' }, 400)
  }

  const user = [
    contractText !== null ? `<contract>\n${contractText}\n</contract>` : '<contract>(none provided)</contract>',
    briefText !== null ? `<brief>\n${briefText}\n</brief>` : '<brief>(none provided)</brief>',
  ].join('\n\n')

  let answer: { data: ModelOutput; model: string }
  try {
    answer = await callForJson<ModelOutput>({
      apiKey: await loadUserKey(auth.userId),
      model: MODEL,
      system: SYSTEM_PROMPT,
      user,
      schema: SCHEMA,
      effort: 'medium',
      maxTokens: 24000,
    })
  } catch (err) {
    return errorResponse(err, 'Parse failed: ')
  }

  const { result } = verifyQuotes(toResult(answer.data), { briefText, contractText })
  const withModel = { ...result, model: answer.model }

  return jsonResponse(version >= 2 ? withModel : legacyShape(withModel))
})
