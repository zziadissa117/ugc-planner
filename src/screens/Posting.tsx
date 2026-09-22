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
  nextUnfilledCell,
  unmarkPosted,
  type PostingBoard,
} from '../data/posting'
import { ensureTodaysQuota } from '../data/today'
import { useData } from '../data/useData'
import { byBestPay, formatCents, toCadCents } from '../money'
import { isMuted, playCashRegister, primeCashRegister, setMuted } from '../sound'

interface Loaded {
  campaigns: Campaign[]
  accounts: CampaignAccount[]
  videos: Video[]
  posts: VideoPost[]
}

const VIEW_KEY = 'ugc-planner.post_view'

function readView(): 'list' | 'network' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'network' ? 'network' : 'list'
  } catch {
    return 'list'
  }
}

export function Posting() {
  const data = useData()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'network'>(readView)

  const changeView = useCallback((next: 'list' | 'network') => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* the choice still holds for this session */
    }
  }, [])
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
        ? // Best-paying campaign first. boardsForToday keeps the order it is given.
          boardsForToday(
            byBestPay(loaded.campaigns, loaded.accounts),
            loaded.accounts,
            loaded.videos,
            loaded.posts,
            today,
          )
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

  const postFromNetwork = useCallback(
    (board: PostingBoard) => {
      const next = nextUnfilledCell(board)
      if (!next) return
      void toggle(board, next.account, next.slot, null)
    },
    [toggle],
  )

  if (!loaded) return null

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* The one way into the network view - a small button rather than
              its own tab, because it is a second way to look at the same
              boxes, not a sixth place in the app. */}
          <button
            type="button"
            onClick={() => changeView(view === 'list' ? 'network' : 'list')}
            aria-label={view === 'list' ? 'Switch to the neural view' : 'Switch to the list view'}
            aria-pressed={view === 'network'}
            className="flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-edge bg-surface text-state-later active:bg-surface-raised"
          >
            <NetworkIcon />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text">Post</h1>
            <p className="text-sm text-state-later">
              {view === 'list'
                ? 'Tick each platform as it goes up. Clears tomorrow.'
                : 'Tap a link to post. Tap a campaign for its brief.'}
            </p>
          </div>
        </div>
        <MadeToday cents={earned} />
      </header>

      {boards.length === 0 ? (
        <p className="text-sm text-state-later">
          No campaigns yet. Add one on <Link to="/campaigns" className="text-state-now">BRIEFS</Link>.
        </p>
      ) : view === 'list' ? (
        boards.map((board) => (
          <CampaignBoard
            key={board.campaign.id}
            board={board}
            busy={busy}
            onToggle={(account, slot, post) => void toggle(board, account, slot, post)}
          />
        ))
      ) : (
        <NeuralView boards={boards} busy={busy} onPost={postFromNetwork} />
      )}
    </section>
  )
}

/** A small constellation - a core with three orbiting points, thin lines
 *  only. Distinct from every other icon in the nav, and nothing else in the
 *  app uses this shape, so it reads as its own thing rather than a stray
 *  tab, and reads as "network" before he ever opens it. */
function NetworkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="0.75" opacity="0.35" />
      <path
        d="M12 12L6.2 8.6M12 12L18.4 9.4M12 12L11 18.6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="6.2" cy="8.6" r="1.3" fill="currentColor" opacity="0.85" />
      <circle cx="18.4" cy="9.4" r="1.3" fill="currentColor" opacity="0.85" />
      <circle cx="11" cy="18.6" r="1.3" fill="currentColor" opacity="0.85" />
    </svg>
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

/** All of today's campaigns as one diagram: a core for him, a thin curved
 *  link running out to each campaign, and a node on every link he taps to
 *  post. The same boxes as the list view - same write, same sound, same
 *  money - laid out as a picture of the day instead of a grid of checkboxes.
 *
 *  The link itself carries the state: dim where nothing has gone out yet,
 *  filling in with a glowing green as he posts, solid and lit once the day's
 *  quota for that campaign is met - "the more I post, it becomes green at
 *  the end of the day." The dot on the link is the one control; tapping it
 *  posts the next open box on the campaign's first ready account, in the
 *  same order the list view would fill it, and one more past the quota once
 *  every box is full - exactly what the dashed "+" does there. The campaign
 *  node itself opens the brief.
 *
 *  Room is deliberate: this reads as a diagram he glances at, not a form he
 *  reads line by line, so it is spaced wide and drawn thin rather than
 *  packed the way the list is. */
function NeuralView({
  boards,
  busy,
  onPost,
}: {
  boards: PostingBoard[]
  busy: string | null
  onPost: (board: PostingBoard) => void
}) {
  const count = boards.length
  // A wide ring, well clear of the core and the edge of the canvas - long
  // spokes read as a network; short ones read as a badge with legs.
  const radius = count <= 2 ? 40 : count <= 4 ? 42 : 44
  const positions = boards.map((_, index) => {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2
    return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) }
  })

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-xl select-none py-10"
      style={{
        // A faint pool of light behind the whole thing, the same device the
        // page background already uses for depth - never a state colour,
        // only atmosphere.
        backgroundImage:
          'radial-gradient(60% 60% at 50% 50%, color-mix(in oklab, var(--color-edge-lit) 20%, transparent), transparent 72%)',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <filter id="neural-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="neural-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-state-now)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--color-state-now)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* A soft halo behind the core, wider than the core itself. */}
        <circle cx={50} cy={50} r={13} fill="url(#neural-core-glow)" />

        {boards.map((board, index) => {
          const { x, y } = positions[index]
          const quota = board.quota
          const progress = quota > 0 ? Math.min(1, board.doneToday / quota) : board.doneToday > 0 ? 1 : 0
          // A slight outward bow instead of a straight spoke - a gentle
          // curve is what makes several of these read as one network rather
          // than a star of rulers.
          const mx = (50 + x) / 2
          const my = (50 + y) / 2
          const nx = -(y - 50)
          const ny = x - 50
          const nlen = Math.hypot(nx, ny) || 1
          const bow = 5
          const cx = mx + (nx / nlen) * bow
          const cy = my + (ny / nlen) * bow
          const path = `M 50 50 Q ${cx} ${cy} ${x} ${y}`

          // The filled portion of the curve, traced to the same fraction of
          // its length as the day's progress. A quadratic Bezier does not
          // shorten linearly with t, but scaling the control point and the
          // endpoint by the same fraction is close enough at this scale to
          // read as "the link is filling in", without needing exact arc math.
          const filledPath =
            progress > 0
              ? `M 50 50 Q ${50 + (cx - 50) * progress} ${50 + (cy - 50) * progress} ${
                  50 + (x - 50) * progress
                } ${50 + (y - 50) * progress}`
              : null

          return (
            <g key={board.campaign.id}>
              <path
                d={path}
                fill="none"
                stroke="var(--color-edge)"
                strokeWidth={0.35}
                strokeLinecap="round"
              />
              {filledPath ? (
                <>
                  {/* A wide, soft duplicate under the crisp line - the glow. */}
                  <path
                    d={filledPath}
                    fill="none"
                    stroke="var(--color-state-posted)"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    opacity={0.35}
                    filter="url(#neural-glow)"
                  />
                  <path
                    d={filledPath}
                    fill="none"
                    stroke="var(--color-state-posted)"
                    strokeWidth={0.45}
                    strokeLinecap="round"
                  />
                </>
              ) : null}
            </g>
          )
        })}
      </svg>

      {/* Him, in the middle - every campaign runs off his own work. Two thin
          static rings stand in for orbits; the glow behind breathes slowly. */}
      <div
        className="core-pulse absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-state-now/60 bg-surface-raised"
        style={{ left: '50%', top: '50%' }}
        aria-hidden
      >
        <span
          aria-hidden
          className="absolute inset-[-10px] rounded-full border border-state-now/15"
        />
        <span
          aria-hidden
          className="absolute inset-[-20px] rounded-full border border-state-now/[0.08]"
        />
        <span className="text-2xl drop-shadow-[0_0_10px_var(--color-state-now)]">🧠</span>
      </div>

      {boards.map((board, index) => {
        const { x, y } = positions[index]
        const quota = board.quota
        const done = quota > 0 && board.doneToday >= quota
        const canPost = board.rows.length > 0
        const next = canPost ? nextUnfilledCell(board) : null
        const busyKey = next ? `${next.account.id}:${next.slot}` : null
        const dotT = 0.62
        const dotX = 50 + (x - 50) * dotT
        const dotY = 50 + (y - 50) * dotT

        return (
          <div key={board.campaign.id}>
            <Link
              to={`/campaigns/${board.campaign.id}`}
              aria-label={`Open the brief for ${board.campaign.name}`}
              className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className="relative flex h-11 w-11 items-center justify-center">
                {/* The same thin orbit rings the core wears, echoing it so
                    every node in the diagram reads as one family of shapes. */}
                <span
                  aria-hidden
                  className={`absolute inset-[-7px] rounded-full border ${
                    done ? 'border-state-posted/25' : 'border-edge/60'
                  }`}
                />
                <span
                  className={[
                    'relative flex h-11 w-11 items-center justify-center rounded-full border text-base font-bold transition-shadow duration-300',
                    done
                      ? 'border-state-posted/70 bg-state-posted/10 text-state-posted drop-shadow-[0_0_12px_var(--color-state-posted)]'
                      : 'border-edge bg-surface-raised text-text',
                  ].join(' ')}
                >
                  {board.campaign.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
              </span>
              <span className="display w-full truncate text-center text-sm leading-tight text-text">
                {board.campaign.name}
              </span>
              <span className="numeric label tracking-[0.14em] text-state-later">
                {board.doneToday} / {quota}
              </span>
            </Link>

            {canPost ? (
              <button
                type="button"
                disabled={busyKey !== null && busy === busyKey}
                onClick={() => onPost(board)}
                aria-label={
                  done
                    ? `${board.campaign.name} is posted today - tap for one more`
                    : `Post for ${board.campaign.name}`
                }
                className={[
                  'absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-sm font-bold transition-transform duration-100 active:scale-90 disabled:opacity-50',
                  done
                    ? 'border-state-posted bg-state-posted text-ink drop-shadow-[0_0_8px_var(--color-state-posted)]'
                    : 'link-pulse border-state-now/60 bg-surface text-state-now active:bg-surface-raised',
                ].join(' ')}
                style={{ left: `${dotX}%`, top: `${dotY}%` }}
              >
                {done ? '✓' : '+'}
              </button>
            ) : null}
          </div>
        )
      })}
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
