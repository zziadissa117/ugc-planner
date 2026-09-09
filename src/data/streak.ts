// How many days running he has put something out.
//
// The one game mechanic the app has, and it is a fact rather than a flourish:
// counted from video_posts at query time like every other countable thing
// here, so there is no stored counter to drift from the log that explains it,
// and nothing has to run at midnight for it to be right.
//
// Deliberately "a day he posted anything", not "a day he hit his quota". Past
// quotas are not stored - campaigns.daily_post_quota is today's number - so
// judging an old day against it would be scoring history against a rule that
// may not have applied. Not breaking the chain is the mechanic anyway.

import { localToday } from './index'
import type { VideoPost } from './schema'

export interface Streak {
  /** Consecutive days ending today, or ending yesterday when today is still
   *  empty. Zero when neither day has anything. */
  days: number
  /** True once today itself counts. While false and days > 0, the streak is
   *  alive but today has not been kept yet - which is the whole of the
   *  pressure the number applies. */
  includesToday: boolean
}

/** The day before `date`, in local terms.
 *
 *  Built from the parts rather than by subtracting milliseconds: a Date built
 *  from "2026-09-08" is parsed as UTC and lands on the 7th for anyone west of
 *  Greenwich, which would drop a day out of the middle of a streak. */
function previousDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return localToday(new Date(year, month - 1, day - 1))
}

export function postingStreak(posts: readonly VideoPost[], today = localToday()): Streak {
  const posted = new Set<string>()
  for (const post of posts) posted.add(localToday(new Date(post.posted_at)))

  const includesToday = posted.has(today)
  // A day that is not over yet must not end the streak. Yesterday still
  // counts, and today is the one he can still keep.
  let cursor = includesToday ? today : previousDay(today)
  if (!posted.has(cursor)) return { days: 0, includesToday: false }

  let days = 0
  while (posted.has(cursor)) {
    days++
    cursor = previousDay(cursor)
  }
  return { days, includesToday }
}
