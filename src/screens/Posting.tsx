// What to post today, per campaign, per account.
//
// His words: "simply track what i need to post for each campaign depending on
// post per day demanded ex: inflow post 1 on ig 1 on tiktok with this handle;
// and vertus 2 on yt 2 on ig w this handle".
//
// So a row is a video, and under it one checkbox per account with the handle
// written out. One video goes to every account and is still one deliverable,
// which is why ticking the last account is what moves the video to `posted`
// and snapshots the rate - not the first.
//
// Accounts that are not `ready` never appear. Posting brand content from an
// account still warming up is the thing warm-up exists to prevent.

import { useCallback, useEffect, useState } from 'react'

import type { Campaign, CampaignAccount, Video, VideoPost } from '../data'
import { useData } from '../data/useData'
import { formatCents } from '../session'

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

  const reload = useCallback(async () => {
    const [campaigns, accounts, videos] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
      // Edited and waiting to go out. Posted videos stay listed so a tick can
      // be undone and so he can see what he has done - rows never vanish.
      data.listVideos({ phases: ['edited', 'posted'] }),
    ])
    const posts = (await Promise.all(videos.map((video) => data.listVideoPosts(video.id)))).flat()
    setLoaded({ campaigns, accounts, videos, posts })
  }, [data])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggle = useCallback(
    async (video: Video, account: CampaignAccount, posted: boolean, readyAccounts: number) => {
      setBusy(`${video.id}:${account.id}`)
      try {
        if (posted) {
          await data.removeVideoPost(video.id, account.id)
          // It is no longer everywhere it needs to be, so it is not posted.
          if (video.phase === 'posted') await data.undoLastPhaseMove(video.id, { session: 'post' })
        } else {
          await data.addVideoPost({
            video_id: video.id,
            account_id: account.id,
            platform: account.platform,
            url: null,
            view_count: null,
            view_count_entered_at: null,
          })
          const now = await data.listVideoPosts(video.id)
          // Re-read rather than trusting the copy this render closed over:
          // two quick taps on different accounts must not disagree about
          // whether the video is already done.
          const current = await data.getVideo(video.id)
          // The last account is what completes the deliverable. Marking it
          // posted on the first would count it as earned before it was.
          if (now.length >= readyAccounts && current !== null && current.phase !== 'posted') {
            await data.markVideoPosted(video.id, { session: 'post' })
          }
        }
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, reload],
  )

  /** One video going out on every ready account at once - the common case
   *  ("post 1 on IG, 1 on TikTok, same video") rather than ticking each
   *  account separately for every video in a backlog. */
  const postEverywhere = useCallback(
    async (video: Video, ready: CampaignAccount[], mine: VideoPost[]) => {
      setBusy(`${video.id}:all`)
      try {
        const already = new Set(mine.map((post) => post.account_id))
        for (const account of ready) {
          if (already.has(account.id)) continue
          await data.addVideoPost({
            video_id: video.id,
            account_id: account.id,
            platform: account.platform,
            url: null,
            view_count: null,
            view_count_entered_at: null,
          })
        }
        const current = await data.getVideo(video.id)
        if (current !== null && current.phase !== 'posted') {
          await data.markVideoPosted(video.id, { session: 'post' })
        }
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, reload],
  )

  if (!loaded) return null

  const { campaigns, accounts, videos, posts } = loaded
  const withWork = campaigns
    .map((campaign) => ({
      campaign,
      accounts: accounts.filter((a) => a.campaign_id === campaign.id && a.status === 'ready'),
      videos: videos.filter((v) => v.campaign_id === campaign.id),
    }))
    .filter((group) => group.videos.length > 0)

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">Post</h1>
        <p className="text-state-later">Tick each account as it goes up.</p>
      </header>

      {withWork.length === 0 ? (
        <p className="text-state-later">
          Nothing ready to post. Edit something first, and it turns up here.
        </p>
      ) : null}

      {withWork.map(({ campaign, accounts: ready, videos: theirs }) => {
        const outstanding = theirs.filter((v) => v.phase !== 'posted').length
        return (
        <div key={campaign.id}>
          <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>
          {outstanding > 1 ? (
            <p className="text-sm text-state-later">
              {outstanding} unposted - filmed and edited faster than they went out.
            </p>
          ) : null}

          {ready.length === 0 ? (
            <p className="mt-1 text-sm font-semibold text-state-blocked">
              No account is ready to post from. Warm one up, or mark one ready on the brief page.
            </p>
          ) : null}

          <ul className="mt-2 flex flex-col gap-3">
            {theirs.map((video) => {
              const mine = posts.filter((post) => post.video_id === video.id)
              const done = video.phase === 'posted'
              return (
                <li
                  key={video.id}
                  className={[
                    'rounded-lg border p-3',
                    done ? 'border-state-posted/50 bg-state-posted/10' : 'border-edge bg-surface',
                  ].join(' ')}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={done ? 'font-semibold text-state-posted' : 'text-text'}>
                      {done ? 'Posted' : 'Ready to post'}
                    </p>
                    <span className="text-sm tabular-nums text-state-later">
                      {campaign.pay_per_video_cents === null
                        ? 'no rate yet'
                        : formatCents(campaign.pay_per_video_cents)}
                    </span>
                  </div>

                  {!done && ready.length > 1 ? (
                    <button
                      type="button"
                      disabled={busy === `${video.id}:all`}
                      onClick={() => void postEverywhere(video, ready, mine)}
                      className="mt-2 min-h-tap w-full rounded-lg border border-state-now bg-surface-raised px-3 text-sm font-semibold text-state-now active:bg-surface disabled:opacity-60"
                    >
                      {busy === `${video.id}:all` ? '...' : 'Posted everywhere'}
                    </button>
                  ) : null}

                  <div className="mt-2 flex flex-col gap-2">
                    {ready.map((account) => {
                      const posted = mine.some((post) => post.account_id === account.id)
                      const key = `${video.id}:${account.id}`
                      return (
                        <button
                          key={account.id}
                          type="button"
                          disabled={busy === key}
                          aria-pressed={posted}
                          onClick={() => void toggle(video, account, posted, ready.length)}
                          className={[
                            'flex min-h-tap items-center justify-between gap-3 rounded-lg border px-3 text-left active:bg-surface-raised disabled:opacity-60',
                            posted
                              ? 'border-state-posted/50 text-state-posted'
                              : 'border-edge text-text',
                          ].join(' ')}
                        >
                          <span>
                            {account.platform}
                            <span className="ml-2 text-sm text-state-later">
                              {account.handle ?? 'no handle saved'}
                            </span>
                          </span>
                          <span aria-hidden className="text-lg">
                            {busy === key ? '...' : posted ? '[x]' : '[ ]'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        )
      })}
    </section>
  )
}
