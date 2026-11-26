// The read behind POST's line beside each campaign's name (LinedUpToday):
// today's videos from the cutter (or Postiz), placed on the planner's
// campaigns by Going out's rule. Read only.

import { useEffect, useMemo, useState } from 'react'

import { videosByCampaign, type GoingOutVideo } from '../data/goingOut'
import type { Campaign, CampaignAccount } from '../data/schema'
import { loadPostizPosts, type PostizPostsAnswer } from '../sync/postizPosts'
import { dayBounds } from '../todaySchedule'
import { useConnection } from './useConnection'

export interface LinedUp {
  /** Today's videos by planner campaign id. */
  byCampaign: Map<string, GoingOutVideo[]>
  /** False when the read came back with a warning, so some may be missing:
   *  "Nothing scheduled" is then not said, because it may not be true. */
  complete: boolean
}

/** Today's videos for the planner's campaigns, read once when the screen
 *  opens (again when the day turns or the connection comes back). Null
 *  until there is something to show: offline, signed out, no key and a
 *  failed read all show nothing. */
export function useLinedUpToday(
  today: string,
  planner: { campaigns: readonly Campaign[]; accounts: readonly CampaignAccount[] } | null,
  load: typeof loadPostizPosts = loadPostizPosts,
): LinedUp | null {
  const { online, tick } = useConnection()
  const [found, setFound] = useState<{ today: string; answer: PostizPostsAnswer | null } | null>(null)

  useEffect(() => {
    if (!online) return
    let cancelled = false
    const { from, to } = dayBounds(new Date(`${today}T12:00:00`))
    load({ from: from.toISOString(), to: to.toISOString() })
      .then((answer) => {
        if (!cancelled) setFound({ today, answer })
      })
      .catch(() => {
        if (!cancelled) setFound({ today, answer: null })
      })
    return () => {
      cancelled = true
    }
    // `tick` reads again when the connection comes back.
  }, [today, load, online, tick])

  const answer = online && found?.today === today ? found.answer : null
  return useMemo(() => {
    if (!answer || !planner || !answer.connected) return null
    // The read itself failed: nothing was counted.
    if (answer.error && !answer.source) return null
    const { from, to } = dayBounds(new Date(`${today}T12:00:00`))
    return {
      byCampaign: videosByCampaign({ posts: answer.posts, campaigns: planner.campaigns, accounts: planner.accounts, from, to }),
      complete: !answer.error,
    }
  }, [answer, planner, today])
}
