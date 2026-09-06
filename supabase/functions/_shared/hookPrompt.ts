// Vendored from src/hooks/hookPrompt.ts.
//
// Edge Functions run on Deno and are deployed independently of the app bundle,
// so this cannot import across the src/ boundary. Per docs/EDGE_FUNCTION.md it
// is copied, not reimplemented - keep it identical to the client's copy, and
// change both in the same commit. src/hooks/hookPromptDriftGuard.test.ts fails
// if they disagree.

/** An angle the campaign documents, with the family it belongs to. */
export interface HookAngle {
  id: string
  label: string
  body: string | null
  /** 'fear' / 'greed' for Inflow. Free text: another brief may split its
   *  angles differently, and inventing a taxonomy for it would be a guess. */
  family: string | null
}

/** Everything the generator is given. Assembled from stored campaign rows -
 *  never from anything the app inferred. */
export interface HookContext {
  campaignName: string
  company: string | null
  /** What the product actually is, in the brief's own words. */
  productFacts: string | null
  audience: string | null
  tone: string | null
  structure: string | null
  /** The never-do list. Passed as hard constraints, not as advice. */
  rules: string[]
  angles: HookAngle[]
  /** The family of the angle used most recently, so the next batch can lean
   *  the other way. Null when nothing has been filmed yet. */
  lastFamily: string | null
  /** How many to write. His goal for the session, not a number we choose. */
  count: number
}

export interface GeneratedHook {
  /** The opening line itself. */
  body: string
  /** Two or three beats after the hook, or null. */
  outline: string | null
  /** Which of the campaign's angles this belongs to. Must be one of the ids
   *  passed in; the function drops anything else rather than inventing one. */
  angle_id: string | null
}

export interface GenerateHooksResult {
  hooks: GeneratedHook[]
  /** Anything the generator could not do, in plain words. */
  warnings: string[]
}

/** The families present in a campaign's angles, in the order they first
 *  appear. Derived, never assumed: a brief that does not split its angles
 *  produces an empty list and no rotation happens. */
export function familiesOf(angles: readonly HookAngle[]): string[] {
  const seen: string[] = []
  for (const angle of angles) {
    if (angle.family === null) continue
    const family = angle.family.trim().toLowerCase()
    if (family !== '' && !seen.includes(family)) seen.push(family)
  }
  return seen
}

/** Which family the next video should lean towards.
 *
 *  SPEC section 11: the brief splits Inflow's angles into FEAR and GREED and
 *  says a good account alternates between them, so the last family used is
 *  tracked and the next batch leans the other way. With fewer than two
 *  families there is nothing to alternate between, and null means "no
 *  preference" rather than a family picked to have an answer. */
export function nextFamily(angles: readonly HookAngle[], lastFamily: string | null): string | null {
  const families = familiesOf(angles)
  if (families.length < 2) return null
  if (lastFamily === null) return families[0]

  const index = families.indexOf(lastFamily.trim().toLowerCase())
  if (index === -1) return families[0]
  return families[(index + 1) % families.length]
}

/** The instruction the model is held to. Written here so it is one text, read
 *  by one prompt, rather than a rule the function states and the UI implies. */
export const HOOK_SYSTEM_PROMPT = `You write opening hooks for a UGC creator's short videos. A hook is the first line said to camera: one or two sentences, spoken, that make someone stop scrolling.

Rules that override everything else:

1. Work only from the campaign material given to you. Every claim in a hook must be supported by the PRODUCT section. Do not add a statistic, a price, a percentage, a guarantee or a feature that is not stated there. If the material is thin, write fewer and simpler hooks and say so in warnings - a hook that invents a fact is worse than no hook, because it reaches a brand as though the creator said it.
2. The NEVER DO list is absolute. A hook that breaks any of those rules is unusable, whatever else is good about it.
3. One angle per hook. Never blend two storylines into one line.
4. Each hook names the angle it belongs to by its id, chosen from the ANGLES given. Never invent an angle id. Use null only if a hook genuinely belongs to none of them.
5. Write the way the VOICE section describes. Spoken, not written: contractions, plain words, no marketing cadence, no "unlock", no "game-changer", no rhetorical question stacking.
6. Do not number them, do not add hashtags, do not write the caption. The hook only.

Call the return_hooks tool exactly once with your hooks. Do not explain yourself outside the tool call.`

/** The user-side message: the campaign, as it is actually stored.
 *
 *  A section with nothing behind it says so rather than being filled in with
 *  something plausible - the same rule the ChatGPT block follows, and for the
 *  same reason: this text is about to become a video that goes to a brand. */
export function buildHookRequest(context: HookContext): string {
  const absent = '(not saved yet)'
  const lines: string[] = []

  lines.push(`CAMPAIGN: ${context.campaignName}${context.company ? ` (${context.company})` : ''}`)
  lines.push('')
  lines.push('PRODUCT - every claim in a hook must be supported by this')
  lines.push(context.productFacts ?? absent)
  lines.push('')
  lines.push('AUDIENCE')
  lines.push(context.audience ?? absent)
  lines.push('')
  lines.push('VOICE')
  lines.push(context.tone ?? absent)
  lines.push('')
  lines.push('STRUCTURE the video follows after the hook')
  lines.push(context.structure ?? absent)
  lines.push('')

  lines.push('NEVER DO - absolute')
  if (context.rules.length === 0) lines.push(absent)
  else for (const rule of context.rules) lines.push(`- ${rule}`)
  lines.push('')

  lines.push('ANGLES - pick one per hook, by id')
  if (context.angles.length === 0) {
    lines.push(absent)
  } else {
    for (const angle of context.angles) {
      const family = angle.family === null ? '' : ` [${angle.family}]`
      const body = angle.body === null ? '' : ` - ${angle.body}`
      lines.push(`- ${angle.id}${family}: ${angle.label}${body}`)
    }
  }
  lines.push('')

  const lean = nextFamily(context.angles, context.lastFamily)
  if (lean !== null) {
    lines.push(
      `ROTATION: the last video used the "${context.lastFamily ?? 'none'}" family, so favour "${lean}" angles in this batch. Mixing in one from another family is fine; repeating the same family throughout is not.`,
    )
    lines.push('')
  }

  lines.push(`Write ${context.count} hooks.`)

  return lines.join('\n')
}

/** The tool schema the model fills. Shared so the function and any test of it
 *  are describing the same shape. */
export const RETURN_HOOKS_SCHEMA = {
  type: 'object',
  properties: {
    hooks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The spoken hook. One or two sentences.' },
          outline: {
            type: ['string', 'null'],
            description: 'Two or three beats after the hook, or null.',
          },
          angle_id: {
            type: ['string', 'null'],
            description: 'One of the angle ids given. Never invented.',
          },
        },
        required: ['body', 'outline', 'angle_id'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['hooks', 'warnings'],
} as const

/** Drops any hook naming an angle the campaign does not have.
 *
 *  A tool schema is a hint, not an enforced type: a model told to pick from a
 *  list will occasionally return an id that is not in it. An angle_id that
 *  points at nothing would break the foreign key on insert, and silently
 *  reassigning it to some other angle would put a hook under a storyline
 *  nobody chose - so the id is dropped and the hook keeps its text. */
export function dropUnknownAngles(
  result: GenerateHooksResult,
  angles: readonly HookAngle[],
): GenerateHooksResult {
  const known = new Set(angles.map((angle) => angle.id))
  const warnings = [...result.warnings]
  let dropped = 0

  const hooks = result.hooks.map((hook) => {
    if (hook.angle_id === null || known.has(hook.angle_id)) return hook
    dropped++
    return { ...hook, angle_id: null }
  })

  if (dropped > 0) {
    warnings.push(
      `${dropped} ${dropped === 1 ? 'hook named an angle' : 'hooks named angles'} this campaign does not have, so ${dropped === 1 ? 'it was' : 'they were'} left without one.`,
    )
  }

  return { hooks, warnings }
}
