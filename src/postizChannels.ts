// What to do in Postiz when a campaign ends, or comes back.
//
// His Postiz plan counts connected channels, and an archived campaign's
// accounts stay connected until he disables them in Postiz by hand - the app
// cannot do it (supabase/functions/planner-postiz). This turns the cutter's
// report into what each account needs from him: white for "do this now",
// grey for done or for an account another live campaign still posts to.
// Pure, so it is tested without the network.

import type { Tone } from './components/styles'

export interface PostizAccount {
  id: string
  name: string
  platform: string
  profile: string
  /** null: the campaign lists it, but Postiz no longer has it. */
  disabled: boolean | null
  alsoUsedBy: { id: string; name: string }[]
  /** Posts still due to go out on it. */
  scheduled: number
}

export interface PostizProfile {
  id: string
  inUse?: number
  accounts?: PostizAccount[]
  error?: string
}

/** Archiving frees channels; restoring switches them back on. */
export type ChannelMode = 'free' | 'restore'

export interface ChannelRow {
  id: string
  name: string
  profile: string
  platform: string
  tone: Tone
  state: string
  /** Something he has to do in Postiz for this one. */
  todo: boolean
  /** Other cutter campaigns set up on it that are not live in the planner. */
  note: string | null
}

export function channelRow(account: PostizAccount, mode: ChannelMode, liveCutterIds: ReadonlySet<string>): ChannelRow {
  const base = { id: account.id, name: account.name, profile: account.profile, platform: account.platform }
  const elsewhere = account.alsoUsedBy.filter((c) => !liveCutterIds.has(c.id)).map((c) => c.name)
  const note = elsewhere.length > 0 ? `also set up for ${elsewhere.join(', ')} in the cutter` : null

  if (account.disabled === null) {
    return { ...base, tone: 'later', state: 'not in Postiz any more', todo: false, note: null }
  }

  if (mode === 'restore') {
    return account.disabled
      ? { ...base, tone: 'now', state: 'disabled - switch it back on', todo: true, note }
      : { ...base, tone: 'later', state: 'connected', todo: false, note }
  }

  const keepFor = account.alsoUsedBy.filter((c) => liveCutterIds.has(c.id)).map((c) => c.name)
  if (keepFor.length > 0) {
    return { ...base, tone: 'later', state: `keep - ${keepFor.join(', ')} still posts here`, todo: false, note }
  }
  return account.disabled
    ? { ...base, tone: 'later', state: 'disabled', todo: false, note }
    : { ...base, tone: 'now', state: 'connected - disable it', todo: true, note }
}

export interface ChannelSummary {
  rows: ChannelRow[]
  /** Accounts he still has to change in Postiz. */
  todo: number
  /** Posts still due on accounts he is about to disable - they would fail. */
  atRisk: number
  /** Connected channels on the Postiz key(s), when every profile answered. */
  inUse: number | null
  errors: string[]
}

export function channelSummary(
  profiles: readonly PostizProfile[],
  mode: ChannelMode,
  liveCutterIds: ReadonlySet<string>,
): ChannelSummary {
  const rows: ChannelRow[] = []
  const errors: string[] = []
  let atRisk = 0
  let inUse: number | null = 0

  for (const profile of profiles) {
    if (profile.error !== undefined) {
      errors.push(profile.error)
      inUse = null
      continue
    }
    if (inUse !== null) inUse += profile.inUse ?? 0
    for (const account of profile.accounts ?? []) {
      const row = channelRow(account, mode, liveCutterIds)
      rows.push(row)
      if (mode === 'free' && row.todo) atRisk += account.scheduled
    }
  }

  return { rows, todo: rows.filter((r) => r.todo).length, atRisk, inUse, errors }
}
