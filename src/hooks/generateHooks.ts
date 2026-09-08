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
    throw new HookGenerationError(`Hook generation failed: ${error.message}`)
  }
  return data as GenerateHooksResult
}

/** Saves generated hooks, each recording the model that wrote it.
 *
 *  The check constraint refuses a generated hook with no model, so this is the
 *  only place the two can be set together - which is what stops a generated
 *  line ever being mistaken later for one he wrote himself. */
export async function saveGeneratedHooks(
  data: DataAdapter,
  campaignId: string,
  result: GenerateHooksResult,
  model: string,
): Promise<number> {
  const generatedAt = new Date().toISOString()
  let saved = 0

  for (const hook of result.hooks) {
    if (hook.body.trim() === '') continue
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
  return saved
}

/** The model the function defaults to. Kept here only so a saved hook can say
 *  what wrote it; the function's own env var is what actually decides. */
export const DEFAULT_HOOK_MODEL = 'claude-sonnet-5'
