// Asking the server for hooks, and keeping what comes back honestly.
//
// The same shape as the parser: the model API key is a server secret, so the
// call goes through an Edge Function, and being able to reach a Supabase
// project is not the same fact as that function being deployed with a key set.
// isAvailable() therefore wants both a configured client and
// VITE_GENERATE_HOOKS_DEPLOYED. Flip the flag when it goes live, not this file.

import type {
  Campaign,
  CampaignAngle,
  CampaignField,
  CampaignHook,
  CampaignRule,
  DataAdapter,
} from '../data'
import { getSupabaseClient } from '../sync/auth'
import {
  type GenerateHooksResult,
  type HookAngle,
  type HookContext,
  nextFamily,
} from './hookPrompt'

export { familiesOf, nextFamily } from './hookPrompt'
export type { GenerateHooksResult, HookAngle, HookContext } from './hookPrompt'

export class HookGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HookGenerationError'
  }
}

export function hookGenerationAvailable(): boolean {
  const deployed = import.meta.env.VITE_GENERATE_HOOKS_DEPLOYED === 'true'
  return deployed && getSupabaseClient() !== null
}

function fieldValue(fields: readonly CampaignField[], key: string): string | null {
  const field = fields.find((f) => f.field_key === key)
  if (!field || field.source === 'missing') return null
  return field.field_value
}

function toHookAngles(angles: readonly CampaignAngle[]): HookAngle[] {
  // Only the angles the campaign's own brief documents. The skill-file angles
  // are is_verified false and are deliberately kept apart (SPEC section 11) -
  // feeding them in here would quietly merge the two sources into the one list
  // the spec says must never exist.
  return angles
    .filter((angle) => angle.is_verified)
    .map((angle) => ({
      id: angle.id,
      label: angle.label,
      body: angle.body,
      family: angle.family,
    }))
}

/** The family of the angle used most recently, read off the videos.
 *
 *  This is what makes the FEAR/GREED alternation real rather than a note in
 *  the brief: the last angle actually filmed decides which way the next batch
 *  leans. Null when nothing has been filmed yet, or when nothing carried an
 *  angle - in which case there is no rotation to continue. */
export async function lastFamilyUsed(
  data: DataAdapter,
  campaignId: string,
  angles: readonly CampaignAngle[],
): Promise<string | null> {
  const videos = await data.listVideos({ campaignId })
  const byId = new Map(angles.map((angle) => [angle.id, angle]))

  const withAngles = videos
    .filter((video) => video.angle_id !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  for (const video of withAngles) {
    const angle = video.angle_id === null ? undefined : byId.get(video.angle_id)
    if (angle?.family) return angle.family
  }
  return null
}

export interface BuildContextInput {
  campaign: Campaign
  fields: readonly CampaignField[]
  rules: readonly CampaignRule[]
  angles: readonly CampaignAngle[]
  /** The campaign's saved hooks. The ones he typed are the creative material
   *  the generator builds from; the ones it generated before are not, or each
   *  batch would be a copy of the last. */
  hooks: readonly CampaignHook[]
  lastFamily: string | null
  count: number
}

/** The field holding a brief he has had worked up and pasted in whole.
 *
 *  He does not write hooks by hand: he has the campaign's brief read and
 *  turned into a document with product facts, audience segments, voice rules,
 *  formats, hook banks and angles, and pastes that in. It is stored as one
 *  campaign_fields row and sent verbatim, never split - the structure is the
 *  point, and it is not a hook, so it never appears in the console's hook
 *  list. */
export const GENERATION_BRIEF_KEY = 'generation_brief'

/** How much of his dumped material to send. Enough to carry the campaign's
 *  voice and formats, capped so a year of accumulated ideas cannot push the
 *  request past what the model will read. */
const MAX_REFERENCE_ENTRIES = 40

/** Everything the generator gets, assembled from stored rows only. */
export function buildContext(input: BuildContextInput): HookContext {
  return {
    campaignName: input.campaign.name,
    company: input.campaign.company,
    productFacts: fieldValue(input.fields, 'product_facts'),
    audience: fieldValue(input.fields, 'audience'),
    tone: fieldValue(input.fields, 'tone'),
    structure: fieldValue(input.fields, 'structure'),
    // The whole pasted document, undivided. See GENERATION_BRIEF_KEY.
    generationBrief: fieldValue(input.fields, GENERATION_BRIEF_KEY),
    rules: input.rules.map((rule) => rule.body),
    angles: toHookAngles(input.angles),
    referenceMaterial: input.hooks
      .filter((hook) => hook.source === 'user_entered')
      .map((hook) => hook.body.trim())
      .filter((body) => body !== '')
      .slice(0, MAX_REFERENCE_ENTRIES),
    lastFamily: input.lastFamily,
    count: input.count,
  }
}

/** Which family the next batch should lean towards, for the label the console
 *  shows him. Uses the same function the prompt does, so the two agree. */
export function leaningFamily(
  angles: readonly CampaignAngle[],
  lastFamily: string | null,
): string | null {
  return nextFamily(toHookAngles(angles), lastFamily)
}

/** The function's own explanation, when it gave one - supabase-js reports
 *  every non-2xx the same way and keeps the reason on the error's context. */
async function describeError(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context as { json?: () => Promise<unknown> } | undefined
  try {
    const body = (await context?.json?.()) as { error?: unknown } | undefined
    if (body && typeof body.error === 'string') return body.error
  } catch {
    /* no readable body */
  }
  return error.message
}

/** Calls the function. Returns what it generated; writes nothing. */
export async function generateHooks(context: HookContext): Promise<GenerateHooksResult> {
  const client = getSupabaseClient()
  if (!client) {
    throw new HookGenerationError(
      'Hook generation is not configured. Write them yourself on the brief page.',
    )
  }

  const { data, error } = await client.functions.invoke('generate-hooks', {
    body: context,
  })

  if (error) {
    throw new HookGenerationError(`Hook generation failed: ${await describeError(error)}`)
  }
  return data as GenerateHooksResult
}

/** Saves generated hooks, each recording the model that wrote it.
 *
 *  The check constraint refuses a generated hook with no model, so this is the
 *  only place the two can be set together - which is what stops a generated
 *  line ever being mistaken later for one he wrote himself. */
/** A hook reduced to the words that carry it, for comparison.
 *
 *  Case, punctuation and the small words go: "This took me nine seconds to
 *  break." and "This took me nine seconds to break, and it never once said it
 *  wasn't sure." are the same hook wearing a different coat, and saving the
 *  second alongside the first fills a slot that should have held something
 *  new. */
const FILLER = new Set([
  'a', 'an', 'and', 'the', 'is', 'it', 'its', 'my', 'me', 'i', 'to', 'of', 'in',
  'on', 'at', 'this', 'that', 'was', 'were', 'right', 'now', 'just', 'so',
])

export function hookFingerprint(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !FILLER.has(word))
    .sort()
    .join(' ')
}

/** True when `body` is recognisably a line the campaign already has.
 *
 *  Containment, not equality: a returned hook that is an existing line plus a
 *  trailing clause contains all of its words, and is the same hook. */
export function alreadyHave(body: string, existing: readonly string[]): boolean {
  const words = new Set(hookFingerprint(body).split(' ').filter((w) => w !== ''))
  if (words.size === 0) return true

  for (const other of existing) {
    const theirs = hookFingerprint(other).split(' ').filter((w) => w !== '')
    if (theirs.length === 0) continue
    const shared = theirs.filter((word) => words.has(word)).length
    // Three quarters of the shorter line's carrying words in common is not a
    // new hook by any reading.
    if (shared / Math.min(theirs.length, words.size) >= 0.75) return true
  }
  return false
}

/** What saving a batch actually did - counted here rather than taken from the
 *  model's own account of itself. The generator's `warnings` turned out to be
 *  where it narrates its process ("Kept angle_id null throughout", "Spread
 *  hooks across Format A x3"), and rendering that gave him a paragraph of
 *  self-justification under every batch. These two numbers are facts the app
 *  knows, and they are the only ones he can act on. */
export interface SaveOutcome {
  /** New hooks written to the campaign. */
  saved: number
  /** Returned hooks that were lines he already had, so were not saved. */
  duplicates: number
}

export async function saveGeneratedHooks(
  data: DataAdapter,
  campaignId: string,
  result: GenerateHooksResult,
  /** Recorded only when the function did not say which model it ran - an
   *  older deployment. See LEGACY_HOOK_MODEL. */
  fallbackModel: string = LEGACY_HOOK_MODEL,
): Promise<SaveOutcome> {
  const generatedAt = new Date().toISOString()
  // What actually wrote them, as the API reported it. The app asking for one
  // model is not proof that model answered.
  const model =
    typeof result.model === 'string' && result.model.trim() !== '' ? result.model : fallbackModel
  let saved = 0
  let duplicates = 0

  // What the campaign already holds, his own and previously generated. The
  // prompt forbids handing his own lines back and it still happened - it
  // returned six rewordings of his hook bank and said so in its warnings - so
  // the guarantee lives here too, where it does not depend on a model
  // following an instruction.
  const existing = (await data.listCampaignHooks(campaignId)).map((hook) => hook.body)

  for (const hook of result.hooks) {
    if (hook.body.trim() === '') continue
    if (alreadyHave(hook.body, existing)) {
      duplicates++
      continue
    }
    existing.push(hook.body)
    await data.addCampaignHook({
      campaign_id: campaignId,
      angle_id: hook.angle_id,
      body: hook.body.trim(),
      outline: hook.outline,
      source: 'generated',
      model,
      generated_at: generatedAt,
      used_at: null,
    })
    saved++
  }
  return { saved, duplicates }
}

/** What a saved hook records when the function did not report its model.
 *
 *  Every hook used to be saved under this constant, whatever the function had
 *  actually run - its GENERATE_HOOKS_MODEL could say otherwise and the label
 *  would still read Sonnet. The function now returns the model the API says
 *  answered, and that is what is saved. This is only the truthful label for a
 *  deployment from before that, which ran Sonnet by default. */
export const LEGACY_HOOK_MODEL = 'claude-sonnet-5'
