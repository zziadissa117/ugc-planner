// IDEATE - what went out and how it did: everything at once, or one campaign
// at a time with its best and weakest videos and the notes on it.
//
// "I need to choose the campaign and have all the analytics, video preview
// then when we click on the video preview it pops up the link on instagram.
// With average views, best performing, worst performing, notes from Ziad,
// your own notes."
//
// The videos and their views are read with the Postiz key saved in SETUP
// (src/sync/postizPosts.ts) - from the cutter's own records when the cutter
// posts with that key, else from Postiz - online only, and read only. The
// notes are local: their own notes save on this device first and sync after,
// and Ziad's arrive by the ordinary sync pull. Offline, the notes still work
// and the videos say they need a connection.

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [posts, retry] = usePostizPosts(period)
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
        title="Your videos"
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
        <p className="-mt-3 text-base text-state-later">
          No campaigns yet.{' '}
          <Link to="/campaigns/new" className="font-semibold text-brand hover:text-text">
            Add a campaign
          </Link>{' '}
          to keep notes on one.
        </p>
      ) : null}

      {/* Shown even with no campaigns: videos the cutter made for a campaign
          the planner does not have still count. */}
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
        onRetry={retry}
      />
    </section>
  )
}

/** The student's posts for the period, read again when the period changes,
 *  the connection comes back, or they ask after a failed read. */
function usePostizPosts(period: IdeatePeriod): [PostsState, () => void] {
  const { online, tick } = useConnection()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; posts: PostsState } | null>(null)
  const key = `${period}|${tick}|${attempt}`
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

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

  if (!online) return [{ kind: 'offline' }, retry]
  // Until the period asked for has been read, show it loading rather than
  // last week's videos under this week's name.
  return [state?.key === key ? state.posts : { kind: 'loading' }, retry]
}
