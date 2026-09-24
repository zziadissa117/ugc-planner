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

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import {
  CheckIcon,
  ListIcon,
  MutedIcon,
  NetworkIcon,
  PlatformGlyph,
  PlusIcon,
  SoundIcon,
} from '../components/icons'
import { ScreenHeader } from '../components/ui'
import { SPRINGS, useSpring } from '../motion'

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
import { useLoaded } from '../data/useLoaded'
import { byBestPay, formatCents, toCadCents } from '../money'
import { isMuted, playCashRegister, primeCashRegister, setMuted } from '../sound'
import { CORE_ID, layoutNetwork, type NetworkEdgeDef, type NetworkNodeDef } from './neuralLayout'
import { NeuralCanvas } from './NeuralCanvas'

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

  // Today's rows are raised before the first read, so the board has the
  // day's obligation behind it rather than filling in as he taps. Running
  // it again on a reload is harmless - it only ever adds rows that are
  // missing, and after the first pass none are.
  const [loaded, reload] = useLoaded<Loaded>(async () => {
    await ensureTodaysQuota(data)
    const [campaigns, accounts, videos, posts] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
      data.listVideos(),
      data.listAllVideoPosts(),
    ])
    return { campaigns, accounts, videos, posts }
  }, [data])

  // Fetched and decoded when the screen opens, not on the first tap, so the
  // till is ready before he can reach a box.
  useEffect(() => {
    primeCashRegister()
  }, [])

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

  const earned = loaded === null ? 0 : earnedOn(loaded.videos, loaded.posts, today, loaded.campaigns)

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

        await reload()
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

  const toggleButton = (
    <button
      type="button"
      onClick={() => changeView(view === 'list' ? 'network' : 'list')}
      aria-label={view === 'list' ? 'Switch to the neural view' : 'Switch to the list view'}
      aria-pressed={view === 'network'}
      className={[
        'press flex size-12 items-center justify-center rounded-full border border-edge text-state-later active:bg-surface',
        // Glassy over the canvas, plain on the page - the same control,
        // dressed for where it is sitting.
        view === 'network' ? 'bg-ink/70 backdrop-blur-md' : '',
      ].join(' ')}
    >
      {/* The icon is where the button takes you, not where you are. */}
      {view === 'list' ? <NetworkIcon className="h-[22px] w-[22px]" /> : <ListIcon className="h-5 w-5" />}
    </button>
  )

  // The network view takes the whole screen. It is a picture of everything
  // he is running, and a picture wants the room - boxed into a square in the
  // middle of a page with a header above it, it read as a widget rather than
  // a place. The negative margins undo the app shell's own padding so the
  // black goes edge to edge, and the height leaves exactly the nav bar.
  if (view === 'network' && boards.length > 0) {
    return (
      <div
        className="relative -mx-4 -mb-6 -mt-5"
        style={{ height: 'calc(100dvh - 3.5rem - env(safe-area-inset-bottom))' }}
      >
        <NeuralView boards={boards} busy={busy} onPost={postFromNetwork} />

        {/* Everything else floats over the canvas rather than stacking above
            it, so nothing eats into the graph's room. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
          <div className="pointer-events-auto">{toggleButton}</div>
          <div className="pointer-events-auto rounded-2xl bg-ink/70 px-3 py-2 backdrop-blur-md">
            <MadeToday cents={earned} compact />
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      {/* The one way into the network view - a small button rather than its
          own tab, because it is a second way to look at the same boxes, not
          a sixth place in the app. */}
      <ScreenHeader
        title="Post"
        meta="Tick each platform as it goes up. Clears tomorrow."
        aside={toggleButton}
      />

      <MadeToday cents={earned} />

      {boards.length === 0 ? (
        <p className="text-base text-state-later">
          No campaigns yet. Add one on <Link to="/campaigns" className="text-state-now underline underline-offset-4">BRIEFS</Link>.
        </p>
      ) : (
        <div className="flex flex-col gap-9">
          {boards.map((board, index) => (
            <div key={board.campaign.id} className="settle-in" style={{ '--i': index } as CSSProperties}>
              <CampaignBoard
                board={board}
                busy={busy}
                onToggle={(account, slot, post) => void toggle(board, account, slot, post)}
              />
            </div>
          ))}
        </div>
      )}
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
function MadeToday({ cents, compact = false }: { cents: number; compact?: boolean }) {
  const [muted, setMutedState] = useState(() => isMuted())
  // The figure rides a spring toward the new total - the same physics as
  // every other movement in the app, run live because it has to be read at
  // every step. Taking a post back down is not an event worth animating, so
  // the figure is never shown above the real total: a drop lands at once.
  const rolling = useSpring(cents, SPRINGS.settle)
  const shown = Math.min(cents, Math.round(rolling))
  // Each rise re-keys the figure so it lands with the pop spring - once per
  // earning, never on a loop.
  const [previous, setPrevious] = useState(cents)
  const [rises, setRises] = useState(0)
  if (cents !== previous) {
    if (cents > previous) setRises((count) => count + 1)
    setPrevious(cents)
  }

  const soundToggle = (
    <button
      type="button"
      onClick={() => {
        const next = !muted
        setMuted(next)
        setMutedState(next)
      }}
      aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
      aria-pressed={muted}
      className="press -m-2 flex size-10 items-center justify-center rounded-full text-state-later active:bg-surface"
    >
      {muted ? <MutedIcon className="h-5 w-5" /> : <SoundIcon className="h-5 w-5" />}
    </button>
  )

  // Green because it is money banked - the same "done" green the boxes use,
  // for the same reason. Grey at zero: nothing has happened yet.
  const tone = shown > 0 ? 'text-state-posted' : 'text-state-later'

  if (compact) {
    return (
      <div className="text-right">
        <p className="label text-state-later">Made today</p>
        <p key={rises} aria-label="Made today" className={`numeric pop-in text-2xl font-semibold leading-none ${tone}`}>
          {formatCents(shown)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-end justify-between gap-4 border-y border-rule py-4">
      <div className="min-w-0">
        <p className="label text-state-later">Made today</p>
        <p
          key={rises}
          aria-label="Made today"
          className={`numeric pop-in mt-2 origin-left font-semibold leading-none ${tone}`}
          style={{ fontSize: 'clamp(2.5rem, 13vw, 3.5rem)' }}
        >
          {formatCents(shown)}
        </p>
        {shown > 0 ? (
          <p className="numeric meta mt-2 text-state-later">~{formatCents(toCadCents(shown))} CAD</p>
        ) : null}
      </div>
      {soundToggle}
    </div>
  )
}

/** All of today's campaigns as one graph, settled by a real force layout
 *  (see neuralLayout.ts) and drawn plainly on a black, pannable, zoomable
 *  canvas (see NeuralCanvas.tsx) - "make that little rectangle pitch black
 *  ... make it cleaner, it's too messy, it's nothing like the picture I
 *  showed you." What he pointed at was a real knowledge-graph: small solid
 *  dots, thin plain lines, quiet labels, nothing glowing or bordered or
 *  spelled out in a lettered avatar. So every ring, pulse, duplicate blurred
 *  line and bordered badge from the earlier attempts is gone - a node is a
 *  dot, an edge is a line, and colour still only ever means state.
 *
 *  The core sits fixed in the middle; every campaign hangs off it at
 *  whatever distance the simulation settles on; every campaign's own
 *  accounts hang off IT in turn - real structure, not invented nodes, and
 *  enough of it to actually cluster the way a graph does.
 *
 *  The core-to-campaign line still carries the day's progress: grey where
 *  nothing has gone out, green as far as he has posted, fully green once the
 *  quota is met - "the more I post, it becomes green at the end of the day."
 *  The small dot beside a campaign is the one control; tapping it posts the
 *  next open box on the campaign's first ready account, in the same order
 *  the list view would fill it. A campaign-to-account line is only ever
 *  structure - it turns green once that platform has actually posted today,
 *  and nothing taps it. The campaign's own dot opens the brief. */
function NeuralView({
  boards,
  busy,
  onPost,
}: {
  boards: PostingBoard[]
  busy: string | null
  onPost: (board: PostingBoard) => void
}) {
  const CORE_R = 6
  const LEAF_R = 2.5

  // Sized by what the campaign pays a video - the same weight the whole app
  // now sorts by, made visible here as size instead of position. A campaign
  // with no rate saved gets the smallest node rather than the app guessing.
  const maxRate = Math.max(1, ...boards.map((b) => b.campaign.pay_per_video_cents ?? 0))
  const campaignR = (board: PostingBoard) => {
    const rate = board.campaign.pay_per_video_cents ?? 0
    return 3.5 + (6 - 3.5) * (rate / maxRate)
  }

  // The graph's shape - which campaigns, which of their accounts - is what
  // the layout depends on. Recomputed only when that shape actually changes,
  // never on a tap: settling the simulation again on every post would jolt
  // every node to a new resting place the instant he tries to read it.
  const signature = boards
    .map((board) => `${board.campaign.id}:${board.rows.map((row) => row.account.id).join(',')}`)
    .join('|')

  const positions = useMemo(() => {
    const nodeDefs: NetworkNodeDef[] = [{ id: CORE_ID, r: CORE_R }]
    const edgeDefs: NetworkEdgeDef[] = []
    for (const board of boards) {
      nodeDefs.push({ id: board.campaign.id, r: campaignR(board) })
      edgeDefs.push({ a: CORE_ID, b: board.campaign.id, ideal: 38 })
      for (const row of board.rows) {
        nodeDefs.push({ id: row.account.id, r: LEAF_R, parentId: board.campaign.id })
        edgeDefs.push({ a: board.campaign.id, b: row.account.id, ideal: 20 })
      }
    }
    return layoutNetwork(nodeDefs, edgeDefs)
    // Deliberately keyed on the graph's shape alone (see comment above), not
    // on `boards` itself - a new array reference every reload must not
    // resettle the whole layout for a tap that changed nothing structural.
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const at = (id: string) => positions.get(id) ?? { x: 50, y: 50 }

  // What the canvas has to show, padded for the largest node and its label -
  // without this the fit-to-screen on open crops a node sitting right at the
  // edge of where the layout happened to settle.
  const bounds = useMemo(() => {
    let minX = 50
    let minY = 50
    let maxX = 50
    let maxY = 50
    for (const { x, y } of positions.values()) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const pad = 10
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
  }, [positions])

  return (
    <NeuralCanvas bounds={bounds} className="h-full w-full">
      {({ px, svg }) => {
        // Every size below is "how many screen pixels this should be at the
        // fitted view". The canvas turns that into its own coordinates, so
        // the graph looks the same on a phone and a laptop, and zooming
        // magnifies it the way zooming into a diagram should.
        return (
          <>
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden
            >
              {/* Structure first, underneath everything - every campaign's
                  own accounts, as plain thin lines that only turn green once
                  that platform has actually posted today. */}
              {boards.map((board) =>
                board.rows.map((row) => {
                  const from = at(board.campaign.id)
                  const to = at(row.account.id)
                  const posted = row.cells.some((cell) => cell.post !== null)
                  return (
                    <line
                      key={row.account.id}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={posted ? 'var(--color-state-posted)' : 'var(--color-edge-lit)'}
                      strokeOpacity={posted ? 0.55 : 0.7}
                      strokeWidth={svg(1)}
                    />
                  )
                }),
              )}

              {boards.map((board) => {
                const { x, y } = at(board.campaign.id)
                const quota = board.quota
                const progress =
                  quota > 0 ? Math.min(1, board.doneToday / quota) : board.doneToday > 0 ? 1 : 0
                const fx = 50 + (x - 50) * progress
                const fy = 50 + (y - 50) * progress
                return (
                  <g key={board.campaign.id}>
                    <line
                      x1={50}
                      y1={50}
                      x2={x}
                      y2={y}
                      stroke="var(--color-edge-lit)"
                      strokeOpacity={0.8}
                      strokeWidth={svg(1.2)}
                    />
                    {progress > 0 ? (
                      <line
                        x1={50}
                        y1={50}
                        x2={fx}
                        y2={fy}
                        stroke="var(--color-state-posted)"
                        strokeWidth={svg(1.6)}
                      />
                    ) : null}
                  </g>
                )
              })}
            </svg>

            {/* Him, in the middle - every campaign runs off his own work. */}
            <div
              aria-hidden
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-state-now"
              style={{
                left: '50%',
                top: '50%',
                height: `${px(15)}px`,
                width: `${px(15)}px`,
                boxShadow: `0 0 ${px(14)}px ${px(1)}px color-mix(in oklab, var(--color-state-now) 45%, transparent)`,
              }}
            />

            {/* Every account, small and quiet - real structure (his own
                platforms), not filler, and the reason the graph has enough in
                it to cluster. */}
            {boards.map((board) =>
              board.rows.map((row) => {
                const { x, y } = at(row.account.id)
                const posted = row.cells.some((cell) => cell.post !== null)
                return (
                  <div
                    key={row.account.id}
                    aria-hidden
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${x}%`, top: `${y}%`, width: `${px(74)}px` }}
                  >
                    <span
                      className={`rounded-full ${posted ? 'bg-state-posted' : 'bg-text-dim'}`}
                      style={{
                        height: `${px(6)}px`,
                        width: `${px(6)}px`,
                        boxShadow: posted
                          ? `0 0 ${px(7)}px color-mix(in oklab, var(--color-state-posted) 60%, transparent)`
                          : undefined,
                      }}
                    />
                    <span
                      className="truncate text-center leading-none text-state-later"
                      style={{ fontSize: `${px(9)}px`, marginTop: `${px(5)}px`, width: '100%' }}
                    >
                      {row.account.platform}
                    </span>
                  </div>
                )
              }),
            )}

            {boards.map((board) => {
              const { x, y } = at(board.campaign.id)
              const quota = board.quota
              const done = quota > 0 && board.doneToday >= quota
              const canPost = board.rows.length > 0
              const next = canPost ? nextUnfilledCell(board) : null
              const busyKey = next ? `${next.account.id}:${next.slot}` : null
              const dot = 11 + 7 * (campaignR(board) - 3.5) / 2.5
              const badge = 15
              // Far enough out, and ringed in the background colour, that a
              // green badge on a green dot still reads as two things.
              const offset = dot / 2 + 3

              return (
                <div key={board.campaign.id}>
                  <Link
                    to={`/campaigns/${board.campaign.id}`}
                    aria-label={`Open the brief for ${board.campaign.name}`}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${x}%`, top: `${y}%`, width: `${px(108)}px` }}
                  >
                    <span
                      className={`rounded-full ${done ? 'bg-state-posted' : 'bg-text-dim'}`}
                      style={{
                        height: `${px(dot)}px`,
                        width: `${px(dot)}px`,
                        boxShadow: done
                          ? `0 0 ${px(13)}px color-mix(in oklab, var(--color-state-posted) 70%, transparent)`
                          : undefined,
                      }}
                    />
                    <span
                      className="truncate text-center font-medium leading-tight text-text"
                      style={{ fontSize: `${px(12.5)}px`, marginTop: `${px(7)}px`, width: '100%' }}
                    >
                      {board.campaign.name}
                    </span>
                    {/* Only where it says something a one-post day cannot:
                        the dot already carries "done" on its own. */}
                    {quota > 1 ? (
                      <span
                        className="numeric leading-none text-state-later"
                        style={{ fontSize: `${px(10)}px`, marginTop: `${px(3)}px` }}
                      >
                        {board.doneToday}/{quota}
                      </span>
                    ) : null}
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
                        'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-bold leading-none active:scale-90 disabled:opacity-50',
                        done
                          ? 'border-state-posted bg-state-posted text-ink'
                          : 'border-state-now/60 bg-ink text-state-now',
                      ].join(' ')}
                      style={{
                        left: `calc(${x}% + ${px(offset)}px)`,
                        top: `calc(${y}% - ${px(offset)}px)`,
                        height: `${px(badge)}px`,
                        width: `${px(badge)}px`,
                        fontSize: `${px(9)}px`,
                        borderWidth: `${px(1)}px`,
                        boxShadow: `0 0 0 ${px(2)}px var(--color-ink)`,
                      }}
                    >
                      {done ? '\u2713' : '+'}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </>
        )
      }}
    </NeuralCanvas>
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
  const filled = doneToday >= quota && quota > 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="display min-w-0 break-words text-3xl text-text">{campaign.name}</h2>
        <p className="numeric meta text-state-later">
          <span className={filled ? 'text-state-posted' : 'text-text'}>
            {doneToday} of {quota} today
          </span>
          {rate === null ? null : <span> · {formatCents(rate)} each</span>}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="border-y border-rule py-3 text-base text-state-blocked">
          No platforms saved. Add them on this campaign's brief.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {rows.map((row) => (
            // Wraps: when the boxes would squeeze the name - four owed a day
            // is five boxes, and "@michael.financier" came out as
            // "@micha / el.finan / cier" - they drop to their own line,
            // right-aligned under it, and the account reads whole.
            <li key={row.account.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="flex min-w-0 flex-1 basis-[10.5rem] items-center gap-3">
                <PlatformGlyph platform={row.account.platform} className="h-5 w-5 shrink-0 text-state-later" />
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="text-base font-semibold text-text">{row.account.platform}</span>
                  <span className="meta text-state-later [overflow-wrap:anywhere]">
                    {row.account.handle ?? 'no handle saved'}
                  </span>
                </span>
              </span>

              <div className="ml-auto flex shrink-0 gap-1.5">
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
                        'press relative flex size-11 items-center justify-center rounded-xl border',
                        'transition-colors duration-200 disabled:opacity-60',
                        done
                          ? // Lit, because green here is the whole point of the
                            // screen: the day's work, proved, from across a room.
                            'lit border-state-posted bg-state-posted/15 text-state-posted'
                          : extra
                            ? 'border-dashed border-edge-lit text-state-later active:bg-surface'
                            : 'border-edge-lit text-state-later active:bg-surface',
                      ].join(' ')}
                    >
                      {busy === key ? (
                        <span aria-hidden className="size-1 rounded-full bg-state-later" />
                      ) : done ? (
                        // Keyed on the post, so the tick pops and draws itself
                        // on once, when it lands - not on every re-render.
                        <span key={cell.post?.id} className="pop-in draw-check flex">
                          <CheckIcon className="h-6 w-6" strokeWidth={2.25} />
                        </span>
                      ) : null}
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
                  className="press flex size-11 items-center justify-center rounded-xl border border-dashed border-edge text-state-later active:bg-surface disabled:opacity-50"
                >
                  <PlusIcon className="h-5 w-5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
