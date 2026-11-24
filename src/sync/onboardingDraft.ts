// A quiz finished before there is an account.
//
// Nothing is written to the store until he is signed in. The answers wait
// here - in this browser, and in the new account's own metadata for when the
// sign-in link opens in another browser or on another device - and the first
// sync pass after sign-in saves them, once the server's rows are pulled. Saved
// before the pull, a week made on a new device would sit beside the week the
// account already had instead of replacing it.
//
// The invite code from a /join link waits here too, until the account step
// sends it with the email (the server checks it: migration 0021).

import type { DataAdapter, PlanBlockKind } from '../data'
import { weekLines, type DraftBlock } from '../data/weeklyPlan'
import { sendQuizFinished } from './quizFinished'

export interface OnboardingDraft {
  blocks: DraftBlock[]
  student_name: string
  timezone: string
  goal: string
  wish: string | null
  minutes_per_day: number
}

const DRAFT_KEY = 'ugc-planner.onboarding_draft'
const INVITE_KEY = 'ugc-planner.invite_code'
/** The account whose carried draft this device has already saved: if
 *  clearing it from the account failed, it is not saved again over a week he
 *  has changed since. */
const SAVED_FOR_KEY = 'ugc-planner.onboarding_saved_for'
const KINDS: readonly PlanBlockKind[] = ['record', 'ideate', 'backup']

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** Only a draft this app wrote: anything else is ignored rather than saved. */
export function parseDraft(value: unknown): OnboardingDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.blocks) || v.blocks.length === 0 || v.blocks.length > 21) return null
  const blocks: DraftBlock[] = []
  for (const raw of v.blocks as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null
    const b = raw as Record<string, unknown>
    if (!KINDS.includes(b.kind as PlanBlockKind)) return null
    if (!whole(b.weekday, 0, 6) || !whole(b.start_minute, 0, 1439) || !whole(b.duration_minutes, 1, 720)) return null
    blocks.push({ kind: b.kind as PlanBlockKind, weekday: b.weekday, start_minute: b.start_minute, duration_minutes: b.duration_minutes })
  }
  if (typeof v.student_name !== 'string' || typeof v.timezone !== 'string' || typeof v.goal !== 'string') return null
  if (v.wish !== null && typeof v.wish !== 'string') return null
  if (!whole(v.minutes_per_day, 1, 720)) return null
  return { blocks, student_name: v.student_name, timezone: v.timezone, goal: v.goal, wish: v.wish as string | null, minutes_per_day: v.minutes_per_day }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the account metadata still carries the draft.
  }
}

export function keepDraft(draft: OnboardingDraft): void {
  write(DRAFT_KEY, JSON.stringify(draft))
}

export function readDraft(): OnboardingDraft | null {
  try {
    return parseDraft(JSON.parse(read(DRAFT_KEY) ?? 'null'))
  } catch {
    return null
  }
}

export function forgetDraft(): void {
  write(DRAFT_KEY, null)
}

/** The draft carried in an account's metadata, unless this device already
 *  saved it for that account. */
export function carriedDraft(userId: string, metadata: unknown): OnboardingDraft | null {
  return read(SAVED_FOR_KEY) === userId ? null : parseDraft(metadata)
}

/** What is waiting to be saved for this account: this browser's draft first,
 *  then the one the account carries. */
export function waitingDraft(userId: string, metadata: unknown): OnboardingDraft | null {
  return readDraft() ?? carriedDraft(userId, metadata)
}

export function markDraftSaved(userId: string): void {
  write(SAVED_FOR_KEY, userId)
}

export function keepInvite(code: string): void {
  write(INVITE_KEY, code)
}

export function readInvite(): string | null {
  return read(INVITE_KEY)
}

export function forgetInvite(): void {
  write(INVITE_KEY, null)
}

/** Saves a waiting draft as his week and his answers, through the same
 *  intents the quiz uses when he is already signed in - so every row is
 *  queued - and tells the owner if this is the account's first quiz. */
export async function applyDraft(data: DataAdapter, draft: OnboardingDraft): Promise<void> {
  const before = await data.getUserSettings()
  await data.replacePlanBlocks(draft.blocks)
  await data.updateUserSettings({
    student_name: draft.student_name,
    timezone: draft.timezone,
    goal: draft.goal,
    wish: draft.wish,
    minutes_per_day: draft.minutes_per_day,
    onboarded_at: before.onboarded_at ?? new Date().toISOString(),
  })
  if (before.onboarded_at === null) {
    void sendQuizFinished({
      name: draft.student_name,
      timezone: draft.timezone,
      goal: draft.goal,
      wish: draft.wish ?? '',
      minutesPerDay: draft.minutes_per_day,
      week: weekLines(draft.blocks),
    })
  }
}
