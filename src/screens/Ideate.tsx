// IDEATE - one campaign at a time: what went out, how it did, and what to
// change next recording.
//
// "I need to choose the campaign and have all the analytics, video preview
// then when we click on the video preview it pops up the link on instagram.
// With average views, best performing, worst performing, notes from Ziad,
// your own notes."
//
// The videos and their views are the student's own Postiz posts, read with
// the key saved in SETUP (src/sync/postizPosts.ts) - online only, and read
// only. The notes are local: their own notes save on this device first and
// sync after, and Ziad's arrive by the ordinary sync pull. Offline, the notes
// still work and the videos say they need a connection.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { IdeateBoard, type NoteEditor, type PostsState } from '../components/IdeateBoard'
import { ChevronRightIcon } from '../components/icons'
import { useConnection } from '../components/useConnection'
import { buttonClass } from '../components/styles'
import { ScreenHeader } from '../components/ui'
import { IDEATE_NOTE_MAX_LENGTH } from '../data/constraints'
import { campaignsInOrder, periodRange, type IdeatePeriod } from '../data/ideate'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { useIsOwner } from '../sync/owner'
import { loadPostizPosts } from '../sync/postizPosts'

export function Ideate() {
  const data = useData()
  const owner = useIsOwner()
  const [period, setPeriod] = useState<IdeatePeriod>('week')

  const [loaded] = useLoaded(async () => {
    const [campaigns, accounts] = await Promise.all([data.listCampaigns(), data.listCampaignAccounts()])
    return { campaigns: campaignsInOrder(campaigns, accounts), accounts }
  }, [data])
  // Read apart from the campaigns, so saving a note reads only the notes again.
  const [ownNotes, reloadOwn] = useLoaded(() => data.listIdeateNotes(), [data])
  const [coachNotes] = useLoaded(() => data.listCoachNotes(), [data])
  const posts = usePostizPosts(period)
  const weekStart = useMemo(() => periodRange(period).weekStart, [period])

  const ownEditor = useMemo<NoteEditor>(
    () => ({
      async save(campaignId, draft) {
        await data.saveIdeateNote({
          id: draft.id,
          campaign_id: campaignId,
          account_id: draft.accountId,
          week_start: draft.weekStart ?? weekStart,
          body: draft.body,
        })
        await reloadOwn()
      },
      async remove(id) {
        await data.deleteIdeateNote(id)
        await reloadOwn()
      },
    }),
    [data, reloadOwn, weekStart],
  )

  if (loaded === null) return null

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <ScreenHeader
        kicker="Ideate"
        title="What's working"
        aside={
          owner ? (
            <Link to="/coach" className={buttonClass('quiet', 'small')}>
              Students
              <ChevronRightIcon className="h-4 w-4 text-brand" />
            </Link>
          ) : null
        }
      />

      {loaded.campaigns.length === 0 ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-base text-text-dim">No campaigns yet.</p>
          <Link to="/campaigns/new" className={buttonClass('now')}>
            Add a campaign
          </Link>
        </div>
      ) : (
        <IdeateBoard
          campaigns={loaded.campaigns}
          accounts={loaded.accounts}
          posts={posts}
          period={period}
          onPeriod={setPeriod}
          weekStart={weekStart}
          ownNotes={ownNotes ?? []}
          coachNotes={coachNotes ?? []}
          ownEditor={ownEditor}
          ownTitle="Your notes"
          // His own planner has no notes from himself to show.
          showCoachNotes={!owner || (coachNotes ?? []).length > 0}
          subject="self"
          ownMaxLength={IDEATE_NOTE_MAX_LENGTH}
        />
      )}
    </section>
  )
}

/** The student's Postiz posts for the period, read again when the period
 *  changes or the connection comes back. */
function usePostizPosts(period: IdeatePeriod): PostsState {
  const { online, tick } = useConnection()
  const [state, setState] = useState<{ key: string; posts: PostsState } | null>(null)
  const key = `${period}|${tick}`

  useEffect(() => {
    if (!online) return
    let cancelled = false
    const put = (posts: PostsState) => {
      if (!cancelled) setState({ key, posts })
    }
    const { from, to } = periodRange(period)
    loadPostizPosts({ from, to })
      .then((answer) => put(answer === null ? { kind: 'signed-out' } : { kind: 'ready', answer }))
      .catch((error: unknown) => put({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }))
    return () => {
      cancelled = true
    }
  }, [key, period, online])

  if (!online) return { kind: 'offline' }
  // Until the period asked for has been read, show it loading rather than
  // last week's videos under this week's name.
  return state?.key === key ? state.posts : { kind: 'loading' }
}
