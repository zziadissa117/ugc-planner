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
import {
  boardsForToday,
  earnedOn,
  markPosted,
  unmarkPosted,
  type PostingBoard,
} from '../data/posting'
import { ensureTodaysQuota } from '../data/today'
import { useData } from '../data/useData'
import { formatCents, toCadCents } from '../money'
import { isMuted, playCashRegister, primeCashRegister, setMuted } from '../sound'

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
    // Fetched and decoded when the screen opens, not on the first tap, so the
    // till is ready before he can reach a box.
    primeCashRegister()
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

  // The same call the home screen makes, so the two can never disagree about
  // what today owes - see boardsForToday.
  const boards = useMemo(
    () =>
      loaded
        ? boardsForToday(loaded.campaigns, loaded.accounts, loaded.videos, loaded.posts, today)
        : [],
    [loaded, today],
  )

  const earned = loaded === null ? 0 : earnedOn(loaded.videos, loaded.posts, today)

  const toggle = useCallback(
    async (board: PostingBoard, account: CampaignAccount, slot: number, post: VideoPost | null) => {
      if (!loaded) return
      setBusy(`${account.id}:${slot}`)

      // Before the write, not after it. He asked for it on every tap - "i
      // want it to play every time i click on any of the buttons" - and a
      // sound that waits for IndexedDB lands a beat late, which is what made
      // it feel like it was firing at random.
      //
      // It used to play only when the money went up, so ticking the second
      // platform for a deliverable was silent. That was defensible and it was
      // not what he wanted: the tap is the thing being acknowledged, and a
      // screen that answers some taps and not others reads as broken rather
      // than as principled. Taking a post back down stays quiet - a till over
      // an undo would be the app celebrating the wrong thing.
      if (post === null) playCashRegister()

      try {
        if (post) await unmarkPosted(data, account, post)
        else await markPosted(data, board, account, slot, loaded.videos, today)

        const [videos, campaigns, accounts] = await Promise.all([
          data.listVideos(),
          data.listCampaigns(),
          data.listCampaignAccounts(),
        ])
        const posts = (await Promise.all(videos.map((v) => data.listVideoPosts(v.id)))).flat()
        setLoaded({ campaigns, accounts, videos, posts })
      } finally {
        setBusy(null)
      }
    },
    [data, loaded, reload, today],
  )

  if (!loaded) return null

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Post</h1>
          <p className="text-sm text-state-later">
            Tick each platform as it goes up. Clears tomorrow.
          </p>
        </div>
        <MadeToday cents={earned} />
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

/** The day's takings, counting up as he ticks.
 *
 *  "add that to the money made today total in a very dopamine giving way.
 *  This is just to help me keep going." So it is the biggest thing on the
 *  screen after the boxes themselves, it moves when it changes, and it shows
 *  CAD underneath - he asked for that conversion on the Money screen for the
 *  same reason, because dollars he can spend are more motivating than dollars
 *  he is paid in.
 *
 *  This is the one figure in the app that counts what happened rather than
 *  what the work pays. The Money screen deliberately counts nothing at all -
 *  every wrong number it ever showed came from counting something - but "what
 *  did I make today" is a question about today, and it is answered from rate
 *  snapshots on deliverables that actually went out. */
function MadeToday({ cents }: { cents: number }) {
  const [shown, setShown] = useState(cents)
  const [muted, setMutedState] = useState(() => isMuted())
  const [flashing, setFlashing] = useState(false)

  useEffect(() => {
    if (cents === shown) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced || cents < shown) {
      setShown(cents)
      return
    }

    // Counts up rather than jumping, because watching it climb is the whole
    // point. 500ms: long enough to read as movement, short enough that a
    // second tick never queues up behind it.
    setFlashing(true)
    const from = shown
    const started = performance.now()
    let frame = 0

    const step = (at: number) => {
      const through = Math.min(1, (at - started) / 500)
      // Ease out, so it lands rather than stopping dead.
      const eased = 1 - (1 - through) ** 3
      setShown(Math.round(from + (cents - from) * eased))
      if (through < 1) frame = requestAnimationFrame(step)
      else setFlashing(false)
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      setFlashing(false)
    }
  }, [cents, shown])

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-2">
        <p className="label text-state-later">
          Made today
        </p>
        <button
          type="button"
          onClick={() => {
            const next = !muted
            setMuted(next)
            setMutedState(next)
          }}
          aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
          aria-pressed={muted}
          className="rounded px-1 label text-state-later active:bg-surface-raised"
        >
          {muted ? 'muted' : 'sound'}
        </button>
      </div>
      <p
        aria-label="Made today"
        className={[
          'numeric text-3xl font-semibold leading-none transition-transform duration-200',
          // Green because it is money banked - the same "done" green the boxes
          // use, for the same reason. Grey at zero: nothing has happened yet.
          shown > 0 ? 'text-state-posted' : 'text-state-later',
          flashing ? 'scale-105' : 'scale-100',
        ].join(' ')}
      >
        {formatCents(shown)}
      </p>
      {shown > 0 ? (
        <p className="numeric mt-0.5 meta text-state-later">
          ~{formatCents(toCadCents(shown))} CAD
        </p>
      ) : null}
    </div>
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
        <h2 className="display min-w-0 break-words text-3xl text-text">{campaign.name}</h2>
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
              {/* The handle wraps under the platform on a narrow phone
                  rather than being truncated mid-word to "@michael.fina..." -
                  the tick boxes to the right need their width, and this is
                  the row he checks to know which account he is ticking. */}
              <span className="flex min-w-0 flex-1 flex-col text-sm text-text sm:flex-row sm:items-baseline sm:gap-2">
                <span className="truncate">{row.account.platform}</span>
                <span className="truncate text-state-later">
                  {row.account.handle ?? 'no handle saved'}
                </span>
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
