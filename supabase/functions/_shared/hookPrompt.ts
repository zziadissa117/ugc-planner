// GENERATED from src/hooks/hookPrompt.ts by scripts/vendor-shared.mjs - do not edit.
// Change the source and run `node scripts/vendor-shared.mjs`.

// What the hook generator is allowed to work from, and what it must not do.
//
// This is the source of record. It is vendored verbatim into
// supabase/functions/_shared/hookPrompt.ts, because Edge Functions run on Deno
// and cannot import across the src/ boundary, and the two copies are held
// together by src/hooks/hookPromptDriftGuard.test.ts.
//
// Two things live here rather than in the function alone:
//
//   - the campaign context assembly, so what the model sees is built from the
//     campaign's own stored material and nothing else, and
//   - the FEAR/GREED rotation, so the console's "next: GREED" label and what
//     is actually generated cannot disagree. If those two drifted, the app
//     would be telling him one thing and asking the model for another.

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
  /** Angles, when the campaign has any. Optional in every sense: most briefs
   *  never name one, nothing asks him to invent them, and generation works
   *  the same with an empty list - it simply has no families to rotate. */
  angles: HookAngle[]
  /** A whole working brief, pasted in as one document.
   *
   *  He does not write hooks by hand - he has the campaign's own brief read
   *  and worked up into a document with its product facts, audience segments,
   *  voice rules, formats, hook banks and angles, and pastes the result into
   *  one box. So this arrives verbatim and undivided: splitting it into
   *  fragments would lose the structure that makes it worth having, and its
   *  own sections are more specific than the four short fields above. */
  generationBrief: string | null
  /** What he dumped into the brief's Hooks & ideas box: hooks, video ideas,
   *  formats, concepts, viral references. This is the most valuable thing in
   *  the request - it is the campaign's own creative material in his own
   *  words - so it is given as the material to build from, not as a list to
   *  copy. */
  referenceMaterial: string[]
  /** The family of the angle used most recently, so the next batch can lean
   *  the other way. Null when nothing has been filmed yet. */
  lastFamily: string | null
  /** How many to write. His goal for the session, not a number we choose. */
  count: number
}

export interface GeneratedHook {
  /** The opening line itself. */
  body: string
  /** The body of the video after this hook: two or three short spoken beats,
   *  one per line, and never the close - "i already have the hook, i just
   *  need inspiration for the body of what im going to say, not the CTA".
   *  Null when the material gives nothing to build a body from. */
  outline: string | null
  /** Which of the campaign's angles this belongs to. Must be one of the ids
   *  passed in; the function drops anything else rather than inventing one. */
  angle_id: string | null
  /** The kind of opening, in two or three words - "confession", "cold open".
   *  Asked for so that no two hooks in a batch can share one, which is what
   *  makes the batch actually varied. Never saved or shown. */
  opening_move?: string
}

export interface GenerateHooksResult {
  hooks: GeneratedHook[]
  /** Anything the generator could not do, in plain words. */
  warnings: string[]
  /** The model that actually wrote them, as the API reported it. A saved
   *  hook records this - not the model the app asked for, which can differ
   *  when a request is rerouted. Absent from an older function. */
  model?: string
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
export const HOOK_SYSTEM_PROMPT = `You write opening hooks for a UGC creator's short videos, and the body beats that follow each one. A hook is the first line said to camera: one or two spoken sentences that make someone stop scrolling. He films these tonight, reading them off a laptop across the room.

## What is fixed

1. Every claim - in a hook or in its beats - must be supported by the PRODUCT section or the WORKING BRIEF. No statistic, price, percentage, guarantee or feature that is not stated there. A hook that invents a fact reaches a brand as though he said it; thin material means fewer, simpler hooks, never invented ones.
2. The NEVER DO list is absolute. A hook that breaks any of it is unusable, however good it is otherwise.
3. One angle per hook. Never blend two storylines into one line.
4. A WORKING BRIEF, when given, is his own worked-up brief and outranks every other section here: follow its formats, voice rules, structure and restrictions exactly, honour any attribution it demands (a claim phrased as something the company says rather than as fact), and where it contradicts a shorter section above, it wins.
5. angle_id is one of the ids in the ANGLES section, or null. Never invent one. "No angles saved" is a fact about the app, not the campaign: if the WORKING BRIEF names its own angles, storylines, families or formats, spread the batch across those exactly as you would saved ones - one per hook, the same family never twice in a row where the brief groups them - with angle_id null.

## What makes a hook good

- A hook is not the pitch. STRUCTURE describes what the video does after the hook, and its first beat is usually the campaign's thesis ("most X do A, this one does B"). Never open with that sentence. The hook buys the three seconds in which the thesis gets said: it is a moment, a receipt, a confession, a thing that just happened.
- Every hook in the batch is a different hook: a different situation, a different opening move, a different reason to stop. Name each one's opening move in opening_move (two or three words - confession, cold open, overheard, receipt, mistake, contrarian, before-and-after, POV, question to self) and use each move at most once. Where the material names formats or audience segments, spread across them. Four hooks that genuinely differ are worth more than ten variations on one line - if the material only supports fewer, write fewer and say what was missing in warnings, but never fewer than three.
- MATERIAL, when given, is his own hooks, ideas and formats. Build from it: its angles of attack, its formats, and above all its register - if his lines are short, spoken and a little unhinged, yours are too. But never hand back a line he already has, from MATERIAL or from a hook bank inside the WORKING BRIEF. One that shares its situation, shape and most of its words with his is his line, not a new one; those banks show you what works so you can write what is not in them yet.
- Spoken, not written, in the VOICE the material describes: contractions, plain words, no marketing cadence, no "unlock", no "game-changer", no stacked rhetorical questions. No numbering, hashtags or captions.

## Body beats

outline is the middle of the video for that hook: two or three beats, one per line, each a few spoken words he can glance at between takes, in the order he would say them. Take them from STRUCTURE and the product facts, and keep them to that hook's angle. Never the call to action or the close - he writes that himself. Null only when the material gives you nothing to say.

## Output

hooks is the deliverable and the only thing he sees. warnings is for what you could not do and what he should know, one short line each - not a narration of your process or a summary of the hooks.`

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

  // First, and whole. When he has pasted a worked-up brief it is the richest
  // and most specific thing in the request - the short fields below are a
  // summary of the same campaign at best, and out of date at worst.
  if (context.generationBrief !== null && context.generationBrief.trim() !== '') {
    lines.push(
      "WORKING BRIEF - the creator's own brief for this campaign. This outranks every section below it.",
    )
    lines.push(context.generationBrief.trim())
    lines.push('')
  }

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

  // His own material, given the most prominent place after the product facts:
  // it is the one part of the request that says what actually works for this
  // campaign rather than what the brand says about itself.
  lines.push('MATERIAL - his own hooks, ideas and formats for this campaign. Build from these.')
  if (context.referenceMaterial.length === 0) {
    lines.push('(none saved - work from the sections above)')
  } else {
    for (const entry of context.referenceMaterial) lines.push(`- ${entry}`)
  }
  lines.push('')

  lines.push('ANGLES - optional. Pick one per hook by id where they exist')
  if (context.angles.length === 0) {
    lines.push('(none saved - leave every angle_id empty, this is normal)')
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

/** The JSON schema the answer must match - enforced by the API as a
 *  structured output, not merely suggested the way a tool schema is. Shared
 *  so the function and any test of it are describing the same shape. */
export const RETURN_HOOKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hooks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          body: { type: 'string', description: 'The spoken hook. One or two sentences.' },
          outline: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Two or three body beats after the hook, one per line. Never the close.',
          },
          angle_id: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'One of the angle ids given, or null. Never invented.',
          },
          opening_move: {
            type: 'string',
            description: 'The kind of opening, two or three words. Unique within the batch.',
          },
        },
        required: ['body', 'outline', 'angle_id', 'opening_move'],
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

  // Both arrays are `required` in the schema and both still have to be
  // checked, for the reason stated above: a tool schema is a hint. A model
  // with nothing to warn about will sometimes omit `warnings` entirely, and
  // spreading undefined threw a TypeError that crashed the whole function -
  // a 500 with no body, on a request that had already been paid for and
  // answered. Missing means empty, which is what it was trying to say.
  const incoming = Array.isArray(result?.hooks) ? result.hooks : []
  const warnings = Array.isArray(result?.warnings) ? [...result.warnings] : []
  let dropped = 0

  const hooks = incoming
    .filter((hook) => typeof hook?.body === 'string' && hook.body.trim() !== '')
    .map((hook) => {
      const angle_id = typeof hook.angle_id === 'string' ? hook.angle_id : null
      const outline = typeof hook.outline === 'string' ? hook.outline : null
      if (angle_id === null || known.has(angle_id)) return { ...hook, angle_id, outline }
      dropped++
      return { ...hook, angle_id: null, outline }
    })

  if (dropped > 0) {
    warnings.push(
      `${dropped} ${dropped === 1 ? 'hook named an angle' : 'hooks named angles'} this campaign does not have, so ${dropped === 1 ? 'it was' : 'they were'} left without one.`,
    )
  }

  return { hooks, warnings }
}
