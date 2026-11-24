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
//
// The screen is about getting the posts done. "X of Y posts done today" is
// the headline; what the day made sits under it, smaller. Each campaign is a
// card in the UGC Roadmap look, and a ticked box is solid green - the posted
// state, readable at arm's length. Every account he has switched on is a row,
// whatever its warm-up status: accounts are ready to post from the start, and
// nothing on this screen mentions warming up.

import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import {
  ChartIcon,
  CheckIcon,
  ChevronDownIcon,
  ListIcon,
  MutedIcon,
  NetworkIcon,
  PlatformGlyph,
  PlusIcon,
  SoundIcon,
} from '../components/icons'
import { SideIncomeToday } from '../components/SideIncomeToday'
import { buttonClass } from '../components/styles'
import { Card, ScreenHeader } from '../components/ui'
import { SPRINGS, useSpring } from '../motion'

import type { Campaign, CampaignAccount, EarningsEvent, SideIncome, Video, VideoPost } from '../data'
import { localToday } from '../data'
import { earnedOnDate, payForAccount, paysPerPlatform } from '../data/earnings'
import {
  boardsForToday,
  markAllOwed,
  markPosted,
  nextUnfilledCell,
  openOwedCells,
  tallyBoards,
  tickedCells,
  unmarkAllToday,
  unmarkPosted,
  type PostingBoard,
} from '../data/posting'
import { ensureTodaysQuota } from '../data/today'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { formatCents, hasOwnPostOrder, inPostOrder, sideIncomeUsdCents, toCadCents } from '../money'
import { useIsOwner } from '../sync/owner'
import { isMuted, playCashRegister, primeCashRegister, setMuted } from '../sound'
import { CORE_ID, layoutNetwork, type NetworkEdgeDef, type NetworkNodeDef } from './neuralLayout'
import { NeuralCanvas } from './NeuralCanvas'

interface Loaded {
  campaigns: Campaign[]
  accounts: CampaignAccount[]
  videos: Video[]
  posts: VideoPost[]
  events: EarningsEvent[]
  /** His detailing and media maxing for today, entered by hand. */
  side: SideIncome[]
}

const VIEW_KEY = 'ugc-planner.post_view'

/** A round icon button - the view switch, the analytics link, the arrows on
 *  Arrange, the sound. The kit's pill (buttonClass) is for words. Split so
 *  no two classes ever set the same property: which of two Tailwind colours
 *  wins is down to stylesheet order, not the order they are written in. */
const ICON_BUTTON =
  'press flex shrink-0 items-center justify-center rounded-full text-text-dim transition-[border-color,background-color,color] duration-200 hover:text-text disabled:cursor-not-allowed disabled:opacity-30'
/** ...with the quiet pill's edge and well, on the page. */
const ICON_BUTTON_EDGED = `${ICON_BUTTON} border border-edge bg-white/[0.02] hover:border-edge-lit hover:bg-white/[0.05]`

function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 639px)').matches : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

function readView(): 'list' | 'network' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'network' ? 'network' : 'list'
  } catch {
    return 'list'
  }
}

/** How many times `value` has gone up since mount. Keying a figure on it
 *  makes the figure pop once per rise - never on a drop, never on a loop. */
function useRises(value: number): number {
  const [previous, setPrevious] = useState(value)
  const [rises, setRises] = useState(0)
  if (value !== previous) {
    if (value > previous) setRises((count) => count + 1)
    setPrevious(value)
  }
  return rises
}

export function Posting() {
  const data = useData()
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'network'>(readView)
  // The network view is a laptop thing: on a phone its dots and labels are
  // too small to read or tap. Below a tablet's width the list is what shows,
  // and the switch to the network is not offered at all.
  const narrow = useNarrowScreen()
  const [reminder, setReminder] = useState<string | null>(null)
  const [arranging, setArranging] = useState(false)

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
    const [campaigns, accounts, videos, posts, events, side] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
      data.listVideos(),
      data.listAllVideoPosts(),
      data.listEarningsEvents({ since: today }),
      data.listSideIncome({ on: today }),
    ])
    return { campaigns, accounts, videos, posts, events, side }
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
        ? // His own order where he has set one, best pay otherwise.
          // boardsForToday keeps the order it is given.
          boardsForToday(
            inPostOrder(loaded.campaigns, loaded.accounts),
            loaded.accounts,
            loaded.videos,
            loaded.posts,
            today,
          )
        : [],
    [loaded, today],
  )

  // The headline. Summed off the same boards, by the same function the home
  // screen uses: a deliverable counts once, the first time it goes out
  // anywhere, however many platforms it then goes to.
  const tally = useMemo(() => tallyBoards(boards), [boards])

  // Off the earnings history, not recomputed from the posts: what each tick
  // paid was written when he ticked it, so the figure cannot move because a
  // rate was edited or a platform switched off since.
  // His detailing and media maxing count into the same figure, a CAD amount
  // converted to USD at the app's fixed rate.
  const earned = loaded === null ? 0 : earnedOnDate(loaded.events, today) + sideIncomeUsdCents(loaded.side)
  const owner = useIsOwner()

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
      if (post === null) {
        playCashRegister()
        if (board.campaign.needs_submission) setReminder(board.campaign.name)
      }

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

  // Every open owed box of one campaign in one tap - seven posts on four
  // accounts no longer means twenty-eight taps. The till sounds once and the
  // submit reminder shows once, as for a single tick.
  const checkAll = useCallback(
    async (board: PostingBoard) => {
      if (openOwedCells(board).length === 0) return
      setBusy(`all:${board.campaign.id}`)
      playCashRegister()
      if (board.campaign.needs_submission) setReminder(board.campaign.name)
      try {
        await markAllOwed(data, board.campaign.id, today)
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, reload, today],
  )

  // Every one of today's ticks on one campaign back down in one tap. Quiet,
  // like a single untick: a till over an undo would celebrate the wrong thing.
  const uncheckAll = useCallback(
    async (board: PostingBoard) => {
      if (tickedCells(board).length === 0) return
      setBusy(`all:${board.campaign.id}`)
      try {
        await unmarkAllToday(data, board.campaign.id, today)
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [data, reload, today],
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
        `${ICON_BUTTON} size-12`,
        // Glassy over the canvas, plain on the page - the same control,
        // dressed for where it is sitting.
        view === 'network'
          ? 'border border-edge bg-ink/70 backdrop-blur-md hover:border-edge-lit'
          : 'border border-edge bg-white/[0.02] hover:border-edge-lit hover:bg-white/[0.05]',
      ].join(' ')}
    >
      {/* The icon is where the button takes you, not where you are. */}
      {view === 'list' ? <NetworkIcon className="h-[22px] w-[22px]" /> : <ListIcon className="h-5 w-5" />}
    </button>
  )

  // The network view takes the whole screen. It is a picture of everything
  // he is running, and a picture wants the room - boxed into a square in the
  // middle of a page with a header above it, it read as a widget rather than
  // a place. The negative margins undo the app shell's own padding (main is
  // px-4 pt-6 pb-8) so the black goes edge to edge, and the height leaves
  // exactly the shell's logo strip (3.25rem) and the nav bar (3.5rem).
  if (view === 'network' && !narrow && boards.length > 0) {
    return (
      <div
        className="relative -mx-4 -mb-8 -mt-6"
        style={{ height: 'calc(100dvh - 6.75rem - env(safe-area-inset-bottom))' }}
      >
        <NeuralView boards={boards} busy={busy} onPost={postFromNetwork} />

        {/* Everything else floats over the canvas rather than stacking above
            it, so nothing eats into the graph's room. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
          <div className="pointer-events-auto">{toggleButton}</div>
          <div className="pointer-events-auto flex flex-col items-end gap-3 rounded-2xl border border-edge bg-ink/70 px-4 py-3 backdrop-blur-md">
            <PostsDone posted={tally.posted} owed={tally.owed} compact />
            <MadeToday cents={earned} compact />
          </div>
        </div>
        <SubmitReminder campaign={reminder} onDone={() => setReminder(null)} />
      </div>
    )
  }

  if (arranging) {
    return (
      <ArrangeCampaigns
        campaigns={boards.map((board) => board.campaign)}
        ownOrder={hasOwnPostOrder(loaded.campaigns)}
        onMove={async (ids) => {
          // Every position rewritten from the list as it now stands, so the
          // numbers stay 0, 1, 2... however many moves came before.
          await Promise.all(
            ids.map((id, position) => {
              const campaign = loaded.campaigns.find((c) => c.id === id)
              return campaign && campaign.post_position !== position
                ? data.updateCampaign(id, { post_position: position })
                : null
            }),
          )
          await reload()
        }}
        onBestPay={async () => {
          await Promise.all(
            loaded.campaigns
              .filter((c) => c.post_position != null)
              .map((c) => data.updateCampaign(c.id, { post_position: null })),
          )
          await reload()
        }}
        onDone={() => setArranging(false)}
      />
    )
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* The one way into the network view - a small button rather than its
          own tab, because it is a second way to look at the same boxes, not
          another place in the app. */}
      <ScreenHeader
        kicker="Post"
        title="Today's posts"
        meta="Tick each platform as it goes up. Clears tomorrow."
        aside={
          <div className="flex items-center gap-2">
            {boards.length > 1 ? (
              <button type="button" onClick={() => setArranging(true)} className={buttonClass('quiet')}>
                Arrange
              </button>
            ) : null}
            {narrow ? null : toggleButton}
          </div>
        }
      />

      {boards.length === 0 ? (
        <Card className="flex flex-col items-start gap-4 p-6">
          <p className="text-lg font-semibold text-text">No campaigns yet.</p>
          <Link to="/campaigns/new" className={buttonClass('now')}>
            Add a campaign
          </Link>
        </Card>
      ) : null}

      {/* The score: posts first, money under it. Side income is his alone. */}
      {boards.length > 0 || owner ? (
        <Card className="flex flex-col gap-5 p-5">
          {boards.length > 0 ? <PostsDone posted={tally.posted} owed={tally.owed} /> : null}
          <div className={`flex flex-col gap-3 ${boards.length > 0 ? 'border-t border-rule pt-4' : ''}`}>
            <MadeToday cents={earned} />
            {owner ? (
              <SideIncomeToday
                entries={loaded.side}
                onAdd={async (entry) => {
                  playCashRegister()
                  await data.addSideIncome({ ...entry, earned_on: today })
                  await reload()
                }}
                onDelete={async (id) => {
                  await data.deleteSideIncome(id)
                  await reload()
                }}
              />
            ) : null}
          </div>
        </Card>
      ) : null}

      {boards.length > 0 ? (
        <div className="flex flex-col gap-4">
          {boards.map((board, index) => (
            <div key={board.campaign.id} className="settle-in" style={{ '--i': index } as CSSProperties}>
              <CampaignBoard
                board={board}
                made={earnedOnDate(
                  loaded.events.filter((event) => event.campaign_id === board.campaign.id),
                  today,
                )}
                busy={busy}
                owner={owner}
                onToggle={(account, slot, post) => void toggle(board, account, slot, post)}
                onCheckAll={() => void checkAll(board)}
                onUncheckAll={() => void uncheckAll(board)}
              />
            </div>
          ))}
        </div>
      ) : null}
      <SubmitReminder campaign={reminder} onDone={() => setReminder(null)} />
    </section>
  )
}

/** Puts the campaigns in the order he wants them on the Post screen: one
 *  up and one down arrow per campaign, and a way back to best pay first. Its
 *  own screen, not arrows beside the tick boxes, so nothing on the posting
 *  grid can move under his thumb. */
function ArrangeCampaigns({
  campaigns,
  ownOrder,
  onMove,
  onBestPay,
  onDone,
}: {
  campaigns: readonly Campaign[]
  ownOrder: boolean
  onMove: (ids: string[]) => Promise<void>
  onBestPay: () => Promise<void>
  onDone: () => void
}) {
  const [saving, setSaving] = useState(false)
  const run = async (work: () => Promise<void>) => {
    setSaving(true)
    try {
      await work()
    } finally {
      setSaving(false)
    }
  }
  const move = (index: number, by: -1 | 1) => {
    const ids = campaigns.map((c) => c.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    void run(() => onMove(ids))
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <ScreenHeader
        kicker="Post"
        title="Arrange"
        meta={ownOrder ? 'Your order.' : 'Best pay first. Move one to use your own order.'}
        aside={
          <button type="button" onClick={onDone} className={buttonClass('now')}>
            Done
          </button>
        }
      />

      <Card className="overflow-hidden">
        <ol className="flex flex-col divide-y divide-rule">
          {campaigns.map((campaign, index) => (
            <li key={campaign.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              {/* The deck's numbered spot. */}
              <span
                aria-hidden
                className="numeric flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand shadow-[inset_0_0_0_1px_rgba(134,168,255,0.28)]"
              >
                {index + 1}
              </span>
              <span className="display min-w-0 flex-1 truncate text-xl text-text">{campaign.name}</span>
              <button
                type="button"
                disabled={saving || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${campaign.name} up`}
                className={`${ICON_BUTTON_EDGED} size-12`}
              >
                <ChevronDownIcon className="h-5 w-5 rotate-180" />
              </button>
              <button
                type="button"
                disabled={saving || index === campaigns.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${campaign.name} down`}
                className={`${ICON_BUTTON_EDGED} size-12`}
              >
                <ChevronDownIcon className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ol>
      </Card>

      {ownOrder ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void run(onBestPay)}
          className={`${buttonClass('ghost')} self-start`}
        >
          Go back to best pay first
        </button>
      ) : null}
    </section>
  )
}

/** Ticking a box submits nothing to the brand, so a campaign set to need
 *  submission follows each tick with this, until he taps Done. Amber: it is
 *  waiting on him. */
function SubmitReminder({ campaign, onDone }: { campaign: string | null; onDone: () => void }) {
  if (campaign === null) return null
  // Rendered into <body>, not in place: the page is inside an element with an
  // entrance animation, and an animated transform on an ancestor pins a
  // `fixed` element to that ancestor instead of the screen - so the reminder
  // sat at the bottom of the page, out of sight unless he had scrolled there.
  return createPortal(
    <div
      role="alert"
      className="pop-in fixed inset-x-4 z-30 mx-auto flex max-w-md items-center justify-between gap-4 rounded-2xl border border-state-waiting/70 bg-surface px-5 py-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.04)]"
      style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
    >
      <span className="flex flex-col gap-1">
        <span className="text-lg font-bold leading-tight text-state-waiting">Did you submit your post?</span>
        <span className="text-sm text-text-dim">{campaign} needs every video submitted.</span>
      </span>
      <button type="button" onClick={onDone} className={`${buttonClass('quiet')} shrink-0`}>
        Done
      </button>
    </div>,
    document.body,
  )
}

/** The headline: how many of today's posts are done, out of how many are
 *  owed. "Post is about completing posts" - so this is the big number, and it
 *  turns green only once the day is actually filled, the same posted state
 *  the boxes use. Under it, one segment per deliverable owed. */
function PostsDone({ posted, owed, compact = false }: { posted: number; owed: number; compact?: boolean }) {
  const done = owed > 0 && posted >= owed
  const rises = useRises(posted)
  const figure = (
    <>
      <span key={rises} className={`pop-in inline-block origin-bottom-left ${done ? 'text-state-posted' : 'text-text'}`}>
        {posted}
      </span>
      <span className="text-state-later"> of {owed}</span>
    </>
  )

  if (compact) {
    return (
      <div role="status" aria-label={`${posted} of ${owed} posts done today`} className="text-right">
        <p className="label text-state-later">Posts done</p>
        <p className="numeric mt-1 text-2xl font-bold leading-none">{figure}</p>
      </div>
    )
  }

  return (
    // A live region, so a screen reader hears the count move as he ticks.
    <div role="status" aria-label={`${posted} of ${owed} posts done today`} className="flex flex-col gap-3">
      <p className="kicker">Posts done today</p>
      <p className="numeric font-bold leading-none" style={{ fontSize: 'clamp(3.25rem, 17vw, 4.5rem)' }}>
        {figure}
      </p>
      {owed > 0 ? <DayBar posted={posted} owed={owed} done={done} /> : null}
    </div>
  )
}

/** The same two numbers as a bar, readable from across the room: one segment
 *  per deliverable, lit green as each goes out. A day owing more than a dozen
 *  is one continuous bar - segments that thin stop reading as segments. */
function DayBar({ posted, owed, done }: { posted: number; owed: number; done: boolean }) {
  if (owed > 12) {
    return (
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={`h-full rounded-full bg-state-posted transition-[width] duration-500 [transition-timing-function:var(--ease-settle)] ${done ? 'cleared' : ''}`}
          style={{ width: `${Math.min(100, (posted / owed) * 100)}%` }}
        />
      </div>
    )
  }
  return (
    <div aria-hidden className="flex gap-1.5">
      {Array.from({ length: owed }, (_, index) => (
        <span
          key={index}
          className={[
            'h-2 flex-1 rounded-full transition-colors duration-300',
            index < posted ? 'bg-state-posted' : 'bg-white/[0.07]',
            done ? 'cleared' : '',
          ].join(' ')}
        />
      ))}
    </div>
  )
}

/** What the day made, counting up as he ticks - now the second line, under
 *  the posts. "add that to the money made today total in a very dopamine
 *  giving way. This is just to help me keep going." It still rolls and still
 *  shows CAD beside it (dollars he can spend are more motivating than dollars
 *  he is paid in), but posts done is the headline and this sits under it.
 *
 *  This is the one figure in the app that counts what happened rather than
 *  what the work pays: it is answered from rate snapshots on deliverables
 *  that actually went out, plus his side income for the day. */
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
  const rises = useRises(cents)

  // Green because it is money banked - the same "done" green the boxes use,
  // for the same reason. Grey at zero: nothing has happened yet.
  const tone = shown > 0 ? 'text-state-posted' : 'text-state-later'

  if (compact) {
    return (
      <div className="text-right">
        <p className="label text-state-later">Made today</p>
        <p key={rises} aria-label="Made today" className={`numeric pop-in mt-1 text-lg font-semibold leading-none ${tone}`}>
          {formatCents(shown)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="label text-state-later">Made today</span>
        <span
          key={rises}
          aria-label="Made today"
          className={`numeric pop-in inline-block origin-left text-xl font-semibold leading-none ${tone}`}
        >
          {formatCents(shown)}
        </span>
        {shown > 0 ? <span className="numeric meta text-state-later">~{formatCents(toCadCents(shown))} CAD</span> : null}
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
        className={`${ICON_BUTTON} size-11 hover:bg-white/[0.05]`}
      >
        {muted ? <MutedIcon className="h-5 w-5" /> : <SoundIcon className="h-5 w-5" />}
      </button>
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
 *  next open box on the campaign's first owed account, in the same order
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

/** One campaign's card: its name, how many of today's posts are done, a
 *  quiet line of what it pays and made, and the grid - one row per account,
 *  one box per deliverable owed today. */
function CampaignBoard({
  board,
  made,
  busy,
  owner = false,
  onToggle,
  onCheckAll,
  onUncheckAll,
}: {
  board: PostingBoard
  /** What this campaign's ticks earned today, off the earnings history. */
  made: number
  busy: string | null
  /** His own account: the views (read from the cutter) are his only. */
  owner?: boolean
  onToggle: (account: CampaignAccount, slot: number, post: VideoPost | null) => void
  onCheckAll: () => void
  onUncheckAll: () => void
}) {
  const { campaign, rows, slots, quota, doneToday } = board
  const rate = campaign.pay_per_video_cents
  const filled = doneToday >= quota && quota > 0
  const open = openOwedCells(board).length
  const ticked = tickedCells(board).length
  const checkingAll = busy === `all:${campaign.id}`
  const headingId = useId()
  // Where each platform pays on its own, the rate lives on each account's
  // row; one figure for the whole campaign would be the wrong one.
  const perPlatform = paysPerPlatform(
    campaign,
    rows.map((row) => row.account),
  )
  const money = [
    perPlatform ? 'paid per platform' : rate === null ? null : `${formatCents(rate)} a post`,
    made > 0 ? `${formatCents(made)} made` : null,
  ].filter((part): part is string => part !== null)
  // Unchecking a whole day is one tap away from a lot of lost green, so the
  // first tap only asks; a second within a few seconds does it.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  return (
    <Card role="group" aria-labelledby={headingId} className="overflow-hidden">
      <div className="flex flex-col gap-3 px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={headingId} className="display break-words text-2xl text-text">
              {campaign.name}
            </h2>
            <p className={`numeric text-lg font-semibold leading-tight ${filled ? 'text-state-posted' : 'text-text'}`}>
              {doneToday} of {quota} today
            </p>
            {/* The money, quietly: posts are what this card is for. */}
            {money.length > 0 ? <p className="numeric meta text-state-later">{money.join(' · ')}</p> : null}
          </div>
          {owner ? (
            <Link
              to={`/post/${campaign.id}/analytics`}
              aria-label={`Analytics for ${campaign.name}`}
              className={`${ICON_BUTTON_EDGED} size-11`}
            >
              <ChartIcon className="h-5 w-5" />
            </Link>
          ) : null}
        </div>

        {/* Only while there is something for them to do: Check all while
            more than one owed box is open, Uncheck all once more than one is
            ticked. Neither ticks anything on its own - each is his tap. */}
        {open > 1 || ticked > 1 ? (
          <div className="flex flex-wrap gap-2">
            {open > 1 ? (
              <button type="button" onClick={onCheckAll} disabled={busy !== null} className={buttonClass('quiet')}>
                {checkingAll ? 'Working…' : `Check all ${open}`}
              </button>
            ) : null}
            {ticked > 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (!armed) {
                    setArmed(true)
                    return
                  }
                  setArmed(false)
                  onUncheckAll()
                }}
                disabled={busy !== null}
                // Amber while it waits for the second tap: past the point of
                // a casual tap, asking to be sure.
                className={buttonClass(armed ? 'waiting' : 'ghost')}
              >
                {armed ? `Tap again to uncheck ${ticked}` : `Uncheck all ${ticked}`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-rule px-4 py-4 text-base text-state-blocked sm:px-5">
          No platforms saved.{' '}
          <Link to={`/campaigns/${campaign.id}`} className="font-semibold underline underline-offset-4">
            Add one on the campaign
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-t border-rule">
          {rows.map((row) => {
            const accountRate = perPlatform && !row.account.bonus_only ? payForAccount(campaign, row.account) : null
            return (
              // Wraps: when the boxes would squeeze the name - four owed a day
              // is five boxes, and "@michael.financier" came out as
              // "@micha / el.finan / cier" - they drop to their own line,
              // right-aligned under it, and the account reads whole.
              <li key={row.account.id} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-5">
                <span className="flex min-w-0 flex-1 basis-[10.5rem] items-center gap-3">
                  <PlatformGlyph platform={row.account.platform} className="h-5 w-5 shrink-0 text-text-dim" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-base font-semibold text-text">{row.account.platform}</span>
                    <span className="meta text-state-later [overflow-wrap:anywhere]">
                      {row.account.handle ?? 'no handle saved'}
                      {row.account.bonus_only ? ' · bonus only, not owed' : ''}
                      {accountRate === null ? '' : ` · ${formatCents(accountRate)} a post`}
                    </span>
                  </span>
                </span>

                <div className="ml-auto flex flex-wrap justify-end gap-2">
                  {row.cells.map((cell) => {
                    const key = `${row.account.id}:${cell.slot}`
                    const done = cell.post !== null
                    // Dashed, like a box beyond the quota: a bonus-only account
                    // is never owed, so none of its boxes is either.
                    const extra = cell.slot >= quota || row.account.bonus_only
                    return (
                      <button
                        key={cell.slot}
                        type="button"
                        disabled={busy === key || checkingAll}
                        aria-pressed={done}
                        aria-label={`${row.account.platform} post ${cell.slot + 1} of ${slots}`}
                        onClick={() => onToggle(row.account, cell.slot, cell.post)}
                        className={[
                          'press relative flex size-12 items-center justify-center rounded-xl border',
                          'transition-[background-color,border-color,box-shadow] duration-200 disabled:opacity-60',
                          done
                            ? // Solid green, because green here is the whole
                              // point of the screen: the day's work, proved,
                              // readable at arm's length.
                              'border-state-posted bg-state-posted text-ink shadow-[0_0_18px_-6px_var(--color-state-posted)]'
                            : extra
                              ? 'border-dashed border-edge-lit bg-ink/60 text-state-later hover:border-state-later'
                              : 'border-state-later/50 bg-ink/60 text-state-later hover:border-state-later',
                        ].join(' ')}
                      >
                        {busy === key ? (
                          <span aria-hidden className={`size-1.5 rounded-full ${done ? 'bg-ink' : 'bg-state-later'}`} />
                        ) : done ? (
                          // Keyed on the post, so the tick pops and draws itself
                          // on once, when it lands - not on every re-render.
                          <span key={cell.post?.id} className="pop-in draw-check flex">
                            <CheckIcon className="h-7 w-7" strokeWidth={2.5} />
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
                    className="press flex size-12 items-center justify-center rounded-xl border border-dashed border-edge text-state-later transition-colors duration-200 hover:border-edge-lit hover:text-text-dim disabled:opacity-50"
                  >
                    <PlusIcon className="h-5 w-5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
