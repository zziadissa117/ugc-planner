// What to post today, per campaign, per platform.
//
// One row per platform the campaign posts to, one box per deliverable owed
// today. Inflow owing one post a day across Instagram, TikTok and YouTube is
// three boxes - one campaign, three destinations - not three Inflows and not
// three payments. Vertus owing four a day on one platform is four boxes.
//
// Nothing here is gated on anything having been filmed in the app: he films
// on his phone, edits elsewhere, and posts things this app never saw. Ticking
// a box records where a deliverable went and locks in its rate; if there is
// no video behind it yet, one is created. See src/data/posting.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign, CampaignAccount, Video, VideoPost } from '../data'
import { localToday } from '../data'
import { buildBoard, markPosted, unmarkPosted, type PostingBoard } from '../data/posting'
import { ensureTodaysQuota } from '../data/today'
import { useData } from '../data/useData'
import { formatCents } from '../money'

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
      data.listVideos(),
    ])
    const posts = (await Promise.all(videos.map((video) => data.listVideoPosts(video.id)))).flat()
    setLoaded({ campaigns, accounts, videos, posts })
  }, [data])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Raise today's rows first so the board has the day's obligation behind
      // it rather than filling in as he taps.
      await ensureTodaysQuota(data)
      if (!cancelled) await reload()
    })()
    return () => {
      cancelled = true
    }
  }, [data, reload])

  const boards = useMemo(() => {
    if (!loaded) return []
    return loaded.campaigns
      .map((campaign) => buildBoard(campaign, loaded.accounts, loaded.posts, today))
      .filter((board) => board.rows.length > 0 || board.quota > 0)
  }, [loaded, today])

  const toggle = useCallback(
    async (board: PostingBoard, account: CampaignAccount, slot: number, post: VideoPost | null) => {
      if (!loaded) return
      setBusy(`${account.id}:${slot}`)
      try {
        if (post) await unmarkPosted(data, account, post)
        else await markPosted(data, board, account, slot, loaded.videos, today)
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, loaded, reload, today],
  )

  if (!loaded) return null

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-text">Post</h1>
        <p className="text-sm text-state-later">
          Tick each platform as it goes up. Clears tomorrow.
        </p>
      </header>

      {boards.length === 0 ? (
        <p className="text-sm text-state-later">
          No campaigns yet. Add one on <Link to="/campaigns" className="text-state-now">BRIEFS</Link>.
        </p>
      ) : null}

      {boards.map((board) => (
        <CampaignBoard
          key={board.campaign.id}
          board={board}
          busy={busy}
          onToggle={(account, slot, post) => void toggle(board, account, slot, post)}
        />
      ))}
    </section>
  )
}

function CampaignBoard({
  board,
  busy,
  onToggle,
}: {
  board: PostingBoard
  busy: string | null
  onToggle: (account: CampaignAccount, slot: number, post: VideoPost | null) => void
}) {
  const { campaign, rows, slots, quota, doneToday } = board
  const rate = campaign.pay_per_video_cents

  return (
    <div className="relative overflow-hidden rounded-2xl border border-edge bg-gradient-to-b from-surface-raised to-surface p-3">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-edge-lit/70" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold tracking-wide text-text">{campaign.name}</h2>
        <p className="numeric text-xs text-state-later">
          <span className={doneToday >= quota && quota > 0 ? 'text-state-posted' : 'text-text'}>
            {doneToday} of {quota} today
          </span>
          {rate === null ? null : <span> · {formatCents(rate)} each</span>}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-state-blocked">
          No platforms saved. Add them on this campaign's brief.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.account.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-text">
                {row.account.platform}
                <span className="ml-2 text-state-later">
                  {row.account.handle ?? 'no handle saved'}
                </span>
                {row.account.status === 'ready' ? null : (
                  <span className="ml-2 text-xs uppercase tracking-wide text-state-waiting">
                    {row.account.status === 'new' ? 'new' : 'warming'}
                  </span>
                )}
              </span>

              <div className="flex shrink-0 gap-1.5">
                {row.cells.map((cell) => {
                  const key = `${row.account.id}:${cell.slot}`
                  const done = cell.post !== null
                  const extra = cell.slot >= quota
                  return (
                    <button
                      key={cell.slot}
                      type="button"
                      disabled={busy === key}
                      aria-pressed={done}
                      aria-label={`${row.account.platform} post ${cell.slot + 1} of ${slots}`}
                      onClick={() => onToggle(row.account, cell.slot, cell.post)}
                      className={[
                        'flex h-10 w-10 items-center justify-center rounded-lg border text-base font-semibold',
                        'transition-transform duration-100 active:scale-95 active:bg-surface-raised disabled:opacity-50',
                        done
                          // Lit, because green here is the whole point of the
                          // screen: the day's work, proved, from across a room.
                          ? 'lit border-state-posted bg-state-posted/15 text-state-posted'
                          : extra
                            ? 'border-dashed border-edge text-state-later'
                            : 'border-edge bg-ink/40 text-state-later',
                      ].join(' ')}
                    >
                      {busy === key ? '·' : done ? '✓' : ''}
                    </button>
                  )
                })}

                {/* One more than owed, always available: he posts extra, and
                    the app has no business telling him he did not. */}
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={`${row.account.platform} extra post`}
                  onClick={() => onToggle(row.account, slots, null)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-edge text-base text-state-later transition-transform duration-100 active:scale-95 active:bg-surface-raised disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
