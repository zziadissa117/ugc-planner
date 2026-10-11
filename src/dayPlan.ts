// Asks the sort-day Edge Function to order his dictation. Returns what it
// sorted; writes nothing - the list is kept by src/dayList.ts.

import { toAiError } from './ai/errors'
import type { SortedInput } from './dayList'
import { getSupabaseClient } from './sync/auth'

export interface SortDayAnswer extends SortedInput {
  /** The model that sorted it, as it reported itself. */
  model: string
}

export class SortDayError extends Error {}

export async function sortDay(text: string, today: string): Promise<SortDayAnswer> {
  const client = getSupabaseClient()
  if (!client) throw new SortDayError('Sorting needs you signed in. Sign in under Setup first.')
  const { data, error } = await client.functions.invoke('sort-day', { body: { text, today } })
  if (error) {
    const failure = await toAiError(error)
    throw new SortDayError(failure.code ? failure.message : `Sorting failed: ${failure.message}`)
  }
  const answer = data as Partial<SortDayAnswer> | null
  if (!answer || !Array.isArray(answer.items) || typeof answer.model !== 'string') throw new SortDayError('Sorting came back empty. Try again.')
  return { items: answer.items, skipped: Array.isArray(answer.skipped) ? answer.skipped : [], model: answer.model }
}
