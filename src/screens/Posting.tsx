// What to post today, per campaign, per account.
//
// His words: "very simply the campaigns platforms and check off if i posted
// in them for the day thats IT. and it renews the next day." So a row is an
// account, not a video: one line per platform he posts to, checked off once
// he has posted on it today, unchecked again the next calendar day.
//
// A checkbox still has to mean something underneath - the rate is only ever
// earned once a video is actually posted - so checking a platform posts the
// oldest edited video not yet posted there, and the video is marked posted
// once every ready account for it has one. An account needing more than one a
// day (posts_per_day > 1) gets a small counter instead of a single box, since
// a checkbox cannot say "two".
//
// Accounts that are not `ready` never appear. Posting brand content from an
// account still warming up is the thing warm-up exists to prevent.

import { useCallback, useEffect, useState } from 'react'

import type { Campaign, CampaignAccount, Video, VideoPost } from '../data'
import { localToday } from '../data'
import { useData } from '../data/useData'

interface Loaded {
  campaigns: Campaign[]
  accounts: CampaignAccount[]
  videos: Video[]
  posts: VideoPost[]
}

export function Posting() {
  const data = useData()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const today = localToday()

  const reload = useCallback(async () => {
    const [campaigns, accounts, videos] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
      // Edited stock, plus already-posted videos so a post made today can
      // still be found and undone.
      data.listVideos({ phases: ['edited', 'posted'] }),
    ])
    const posts = (await Promise.all(videos.map((video) => data.listVideoPosts(video.id)))).flat()
    setLoaded({ campaigns, accounts, videos, posts })
  }, [data])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Posts this account picked up today - what makes the checkbox checked,
   *  and what resets it tomorrow without anything having to run at midnight. */
  const postsToday = useCallback(
    (accountId: string, posts: readonly VideoPost[]) =>
      posts.filter((post) => post.account_id === accountId && localToday(new Date(post.posted_at)) === today),
    [today],
  )

  const logOne = useCallback(
    async (campaign: Campaign, account: CampaignAccount, videos: Video[], posts: VideoPost[]) => {
      // Oldest edited video this account has not already posted, so the
      // backlog drains in the order it was finished.
      const candidates = videos
        .filter((v) => v.campaign_id === campaign.id && v.phase === 'edited')
        .filter((v) => !posts.some((p) => p.video_id === v.id && p.account_id === account.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      const video = candidates[0]
      if (!video) return

      setBusy(`${account.id}:log`)
      try {
        await data.addVideoPost({
          video_id: video.id,
          account_id: account.id,
          platform: account.platform,
          url: null,
          view_count: null,
          view_count_entered_at: null,
        })
        const mine = await data.listVideoPosts(video.id)
        const ready = (await data.listCampaignAccounts(campaign.id)).filter((a) => a.status === 'ready')
        const current = await data.getVideo(video.id)
        // The last account is what completes the deliverable. Marking it
        // posted on the first would count it as earned before it was.
        if (mine.length >= ready.length && current !== null && current.phase !== 'posted') {
          await data.markVideoPosted(video.id, { session: 'post' })
        }
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, reload],
  )

  const undoOne = useCallback(
    async (account: CampaignAccount, posts: readonly VideoPost[]) => {
      // Undoes the most recent post to this account today - a mis-tap should
      // take back what was just done, not an arbitrary one of several.
      const mine = postsToday(account.id, posts)
      const last = mine[mine.length - 1]
      if (!last) return

      setBusy(`${account.id}:undo`)
      try {
        await data.removeVideoPost(last.video_id, account.id)
        const current = await data.getVideo(last.video_id)
        // It is no longer everywhere it needs to be, so it is not posted.
        if (current !== null && current.phase === 'posted') {
          await data.undoLastPhaseMove(last.video_id, { session: 'post' })
        }
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, postsToday, reload],
  )

  if (!loaded) return null

  const { campaigns, accounts, videos, posts } = loaded
  const withAccounts = campaigns
    .map((campaign) => ({
      campaign,
      ready: accounts.filter((a) => a.campaign_id === campaign.id && a.status === 'ready'),
    }))
    .filter((group) => group.ready.length > 0)

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">Post</h1>
        <p className="text-state-later">Check off each platform as you post to it. Resets tomorrow.</p>
      </header>

      {withAccounts.length === 0 ? (
        <p className="text-state-later">
          No account is ready to post from yet. Warm one up first.
        </p>
      ) : null}

      {withAccounts.map(({ campaign, ready }) => (
        <div key={campaign.id}>
          <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {ready.map((account) => (
              <li key={account.id}>
                <AccountRow
                  account={account}
                  doneToday={postsToday(account.id, posts).length}
                  hasCandidate={videos.some(
                    (v) =>
                      v.campaign_id === campaign.id &&
                      v.phase === 'edited' &&
                      !posts.some((p) => p.video_id === v.id && p.account_id === account.id),
                  )}
                  busy={busy === `${account.id}:log` || busy === `${account.id}:undo`}
                  onLog={() => void logOne(campaign, account, videos, posts)}
                  onUndo={() => void undoOne(account, posts)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function AccountRow({
  account,
  doneToday,
  hasCandidate,
  busy,
  onLog,
  onUndo,
}: {
  account: CampaignAccount
  doneToday: number
  hasCandidate: boolean
  busy: boolean
  onLog: () => void
  onUndo: () => void
}) {
  const target = Math.max(1, account.posts_per_day)
  const label = (
    <span>
      {account.platform}
      <span className="ml-2 text-sm text-state-later">{account.handle ?? 'no handle saved'}</span>
    </span>
  )

  if (target === 1) {
    const checked = doneToday >= 1
    return (
      <button
        type="button"
        disabled={busy || (!checked && !hasCandidate)}
        aria-pressed={checked}
        onClick={checked ? onUndo : onLog}
        className={[
          'flex min-h-tap w-full items-center justify-between gap-3 rounded-lg border px-3 text-left active:bg-surface-raised disabled:opacity-60',
          checked ? 'border-state-posted/50 text-state-posted' : 'border-edge text-text',
        ].join(' ')}
      >
        {label}
        <span className="shrink-0 text-sm">
          {busy ? '...' : checked ? '[x]' : !hasCandidate ? 'nothing ready to post' : '[ ]'}
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-h-tap items-center justify-between gap-3 rounded-lg border border-edge px-3 py-2">
      {label}
      <div className="flex shrink-0 items-center gap-3">
        <span className={`text-sm tabular-nums ${doneToday >= target ? 'text-state-posted' : 'text-state-later'}`}>
          {doneToday} of {target} today
        </span>
        <button
          type="button"
          disabled={busy || doneToday === 0}
          onClick={onUndo}
          className="min-h-tap min-w-tap rounded-lg border border-edge text-text active:bg-surface-raised disabled:opacity-40"
        >
          -
        </button>
        <button
          type="button"
          disabled={busy || doneToday >= target || !hasCandidate}
          onClick={onLog}
          className="min-h-tap min-w-tap rounded-lg border border-edge text-text active:bg-surface-raised disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  )
}
