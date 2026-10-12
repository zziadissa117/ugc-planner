// Turning his dictation - everything he has to do this week, said out loud -
// into one list, most important first. The Edge Function (sort-day) asks the
// model with this prompt and schema; the browser keeps the list
// (src/dayList.ts).
//
// Plain TypeScript with no imports, so vitest runs it as it is
// (dayPrompt.test.ts) and Deno deploys it unchanged.

/** A dictation longer than this is not a day or a week, it is a diary. */
export const MAX_DICTATION = 20_000
export const MAX_ITEMS = 40
export const MAX_STEPS = 15

export interface SortedItem {
  /** What to do, short, in his own words. */
  text: string
  /** One plain line: why it sits where it does. */
  why: string
  /** Something he said to do every day, or a one-off. */
  repeat: 'daily' | 'once'
  /** The parts he listed under it - each app to apply on, each account to
   *  warm up. Empty when he listed none. */
  steps: string[]
  /** Only when he named one ("before my birthday", "for tomorrow"). */
  deadline: string | null
}

export interface SortDayResult {
  /** Most important first. */
  items: SortedItem[]
  /** What he said that needs nothing doing ("my planner works fine"), so he
   *  can see nothing was dropped by accident. */
  skipped: string[]
}

export const SORT_DAY_SYSTEM_PROMPT = `You turn a UGC creator's spoken to-do dump into one ordered to-do list.

He makes money posting brand videos (UGC campaigns) after his day job. He dictates everything he has to do for the day or the week in one go and gets lost in it. Your job is to pull out every task he said and put them in the order he should do them: most important first.

Rules - follow every one:
- Only what he said. Never add a task, an app, an account, a purchase, a deadline or a detail he did not say. If he listed apps, use exactly his list, his spelling cleaned up only where it is obviously a dictation slip.
- Each item is one thing to do, written short and plainly in his own words ("Apply for campaigns on every app", "Buy a light for better lighting"). Imperative, no filler, no emojis.
- Put the parts he listed under an item as its steps: the apps he will apply on, the accounts he will warm up, the campaigns he will onboard. A step is a few words ("Gimi", "Warm up Vaza accounts").
- repeat is "daily" only when he said to do it every day (or every single day of the week); otherwise "once".
- deadline only when he said one ("for tomorrow", "before my birthday"), in his words; otherwise null.
- Order by what moves money soonest:
  1. Getting campaigns and doing the posts that pay (applying for campaigns, today's posts).
  2. Things that unblock paid work soon: warming up accounts he will post on tomorrow, onboarding paid campaigns, accounts needed to get paid (e.g. a wallet to receive a payout), fixing a banned account.
  3. Upgrades that make the content better (lighting, background, camera).
  4. Upkeep and nice-to-haves (cleaning, organising).
  A stated deadline moves an item up within its level. A big goal he states ("get more campaigns consistently") becomes the concrete action he gave for it, not a vague item.
- why is one short plain line on why it sits there ("Brings in new campaigns - that's the money"). No more than 12 words.
- Statements that need no action ("my planner and cutter work perfectly", "I'll be happy after that") go in skipped, quoted briefly - never as items.
- Do not merge two different tasks into one item, and do not split one task into several items: parts go in steps.`

/** The request: his words, and today's date so "tomorrow" means something. */
export function buildDayRequest(text: string, today: string): string {
  return `Today is ${today}.\n\nHis dictation:\n"""\n${text.trim()}\n"""\n\nReturn the list.`
}

export const SORT_DAY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'skipped'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'why', 'repeat', 'steps', 'deadline'],
        properties: {
          text: { type: 'string' },
          why: { type: 'string' },
          repeat: { type: 'string', enum: ['daily', 'once'] },
          steps: { type: 'array', items: { type: 'string' } },
          deadline: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    skipped: { type: 'array', items: { type: 'string' } },
  },
}

const line = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** The answer, held to its limits: blank items and steps dropped, long ones
 *  cut, at most MAX_ITEMS. The schema guarantees the shape; this keeps a
 *  model that rambles from filling his home screen. */
export function cleanSorted(raw: unknown): SortDayResult {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((entry): SortedItem => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const deadline = line(item.deadline, 80)
      return {
        text: line(item.text, 200),
        why: line(item.why, 160),
        repeat: item.repeat === 'daily' ? 'daily' : 'once',
        steps: (Array.isArray(item.steps) ? item.steps : []).map((s) => line(s, 120)).filter(Boolean).slice(0, MAX_STEPS),
        deadline: deadline || null,
      }
    })
    .filter((item) => item.text !== '')
    .slice(0, MAX_ITEMS)
  const skipped = (Array.isArray(body.skipped) ? body.skipped : []).map((s) => line(s, 200)).filter(Boolean).slice(0, 20)
  return { items, skipped }
}
