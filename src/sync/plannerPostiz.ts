// The planner's call to its planner-postiz function: which Postiz channels a
// cutter campaign holds (src/postizChannels.ts says what to do with them).
// Owner only - for anyone else the function answers `enabled: false` and this
// returns null, so nothing is shown.

import { toAiError } from '../ai/errors'
import type { PostizProfile } from '../postizChannels'
import { getSupabaseClient } from './auth'

export async function postizChannels(cutterCampaignId: string): Promise<PostizProfile[] | null> {
  const client = getSupabaseClient()
  if (!client) return null
  const { data, error } = await client.functions.invoke('planner-postiz', {
    body: { action: 'channels', cutterCampaignId },
  })
  if (error) throw new Error((await toAiError(error)).message)
  const answer = data as { enabled?: unknown; profiles?: unknown } | null
  return answer?.enabled === true && Array.isArray(answer.profiles) ? (answer.profiles as PostizProfile[]) : null
}

// What the last check found, per campaign, so the Archived list can say
// "2 still connected" without asking Postiz for every row. A convenience on
// this device only: the panel always checks again when opened.

const KEY = (campaignId: string) => `ugc-planner.postiz-todo.${campaignId}`

export function rememberTodo(campaignId: string, todo: number): void {
  try {
    localStorage.setItem(KEY(campaignId), String(todo))
  } catch {
    // Private window or storage off: the list just says "not checked".
  }
}

export function rememberedTodo(campaignId: string): number | null {
  try {
    const raw = localStorage.getItem(KEY(campaignId))
    return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
  } catch {
    return null
  }
}

const LIMIT_KEY = 'ugc-planner.postiz-channel-limit'

/** How many channels his Postiz plan allows. 30 until he says otherwise. */
export function channelLimit(): number {
  try {
    const raw = localStorage.getItem(LIMIT_KEY)
    return raw !== null && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : 30
  } catch {
    return 30
  }
}

export function saveChannelLimit(limit: number): void {
  try {
    localStorage.setItem(LIMIT_KEY, String(limit))
  } catch {
    // Falls back to 30 next time.
  }
}
