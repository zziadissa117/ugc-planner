// The home screen: what today owes, what is filmed, and one way into filming.
//
// What used to be here and is not any more: a session-type chooser, a "how
// long tonight" window picker, an EDIT console, a POST session and a planner
// that packed an evening for him. He asked for a target and a scoreboard, and
// every one of those was a decision standing between him and the camera.
//
// What is left is: the day's count, one tap to mark a filmed video edited,
// FILM against a goal, and warm-up.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import {
  BackIcon,
  CheckIcon,
  ChevronRightIcon,
  FilmIcon,
  PlatformGlyph,
  PostIcon,
} from '../components/icons'
import { ActionTile, Button, SectionLabel, StateDot } from '../components/ui'
import { INPUT_CLASS, TONE_TEXT, type Tone } from '../components/styles'

import type { Streak } from '../data/streak'
import { KNOWN_PLATFORMS } from '../components/platforms'
import { byBestPay } from '../money'
import { formatClock, secondsLeft } from '../warmupTimer'
import { useWarmupTimers } from '../warmupTimers'
import type {
  Campaign,
  CampaignAccount,
  CampaignRule,
  Video,
  VideoPost,
  WarmupEvent,
} from '../data'
import {
  WARMUP_SESSIONS_REQUIRED,
  compareWarmupPriority,
  daysSince,
  lastWarmupAt,
  localToday,
  needsWarmup,
  warmsUp,
  warmupCompletions,
  warmupMinutesFor,
  warmupTier,
} from '../data'
import { postingStreak } from '../data/streak'
import {
  MILESTONES_MS,
  elapsedMs,
  formatElapsed,
  isRunning,
  pause as pauseWork,
  readWorkDay,
  reset as resetWork,
  start as startWork,
  writeWorkDay,
  type WorkDay,
} from '../data/workClock'
import { ensureTodaysQuota, summariseToday } from '../data/today'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { formatCents } from '../money'
import { Console } from './Console'

/** Presets for the goal. He batches roughly seven in a filming session. */
const GOAL_PRESETS = [3, 5, 7, 10] as const
const DEFAULT_GOAL = 7

/** `work_sessions.planned_minutes` is `not null check (> 0)` in the schema,
 *  but nothing asks for a time budget any more - he watches the goal count.
 *  Bookkeeping only: never surfaced, never compared against. */
const FILM_SESSION_PLANNED_MINUTES = 120

/** Nothing asks how long a warm-up runs: it comes from what the account is
 *  for. Fifteen minutes while it is being built a history, five to keep a
 *  ready one alive. See warmupMinutesFor. */

type Stage =
  | { kind: 'home' }
  | { kind: 'pick_campaign' }
  | { kind: 'briefing'; campaign: Campaign }
  | { kind: 'console'; campaign: Campaign; goal: number; workSessionId: string }
  | { kind: 'warmup_timer'; account: CampaignAccount; campaign: Campaign | null }
  | { kind: 'work' }

/** The rows before the first read lands. Nothing renders until it does. */
const NOTHING_YET = {
  campaigns: [] as Campaign[],
  videos: [] as Video[],
  warmupEvents: [] as WarmupEvent[],
  accounts: [] as CampaignAccount[],
  posts: [] as VideoPost[],
}

export function Now() {
  const data = useData()
  const timers = useWarmupTimers()
  const location = useLocation()
  const navigate = useNavigate()

  // Today's obligation is raised as rows before anything is counted, so the
  // "X of Y" line is never briefly wrong. Harmless on a reload: it only adds
  // rows that are missing.
  const [snapshot, reload] = useLoaded(async () => {
    await ensureTodaysQuota(data)
    const [campaigns, videos, warmupEvents, accounts, posts] = await Promise.all([
      data.listCampaigns(),
      data.listVideos(),
      data.listWarmupEvents(),
      data.listCampaignAccounts(),
      data.listAllVideoPosts(),
    ])
    return { campaigns, videos, warmupEvents, accounts, posts }
  }, [data])
  const loaded = snapshot !== null
  const { campaigns, videos, warmupEvents, accounts, posts } = snapshot ?? NOTHING_YET
  const [editBusy, setEditBusy] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'home' })
  /** Read from storage on mount, so leaving the page - or reloading, or
   *  closing the tab - never loses the stretch he is in. */
  const [workDay, setWorkDay] = useState<WorkDay>(() => readWorkDay())

  const changeWork = useCallback((next: WorkDay) => {
    writeWorkDay(next)
    setWorkDay(next)
  }, [])

  const summary = useMemo(
    () => summariseToday(campaigns, accounts, videos, posts),
    [accounts, campaigns, posts, videos],
  )

  // Every account that warms up at all, not only the ones still being built.
  // He asked to keep them all in front of him - "just to make sure i keep them
  // fresh and remember" - with the not-ready ones first, because those are the
  // ones holding a campaign off the Post tab. YouTube is not here at all:
  // "youtube accounts dont need to warmup so remove them from warmups."
  const warmupAccounts = useMemo(() => {
    // Only accounts belonging to a campaign still on the books. Deleting a
    // campaign now takes its accounts down with it, but a campaign deleted
    // before it did left its handles here with nothing on any screen able to
    // explain them or get rid of them - so the list is filtered as well as
    // the delete being fixed, and those orphans go on sight.
    const live = new Set(campaigns.map((c) => c.id))
    return accounts
      .filter(
        (account) => account.is_active && live.has(account.campaign_id) && warmsUp(account),
      )
      .sort((a, b) => {
        const byStatus = Number(needsWarmup(b)) - Number(needsWarmup(a))
        return byStatus !== 0 ? byStatus : a.platform.localeCompare(b.platform)
      })
  }, [accounts, campaigns])

  // Where each campaign stands on pay, 0 being the best. The warm-up list
  // puts the campaign that pays best first inside each group.
  const payRank = useMemo(
    () => new Map(byBestPay(campaigns, accounts).map((c, index) => [c.id, index])),
    [accounts, campaigns],
  )

  const beginConsole = useCallback(
    async (campaign: Campaign, goal: number) => {
      const workSession = await data.startWorkSession({
        campaign_id: campaign.id,
        kind: 'film',
        goal_videos: goal,
        planned_minutes: FILM_SESSION_PLANNED_MINUTES,
        ended_at: null,
      })
      setStage({ kind: 'console', campaign, goal, workSessionId: workSession.id })
    },
    [data],
  )

  // A warm-up marked done from the strip at the top of the page - while he was
  // on some other screen, or with this one already open - has to show up here.
  const { completions } = timers
  useEffect(() => {
    if (completions > 0) void reload()
  }, [completions, reload])

  /** Opens the warm-up screen for an account. If a timer is already running
   *  for it - reopened from the strip, or tapped a second time - this only
   *  shows it; the screen itself is what starts a fresh one, once he has
   *  picked how long, so a tap here is never what begins the clock. */
  const openTimer = useCallback(
    (account: CampaignAccount) => {
      const campaign = campaigns.find((c) => c.id === account.campaign_id) ?? null
      setStage({ kind: 'warmup_timer', account, campaign })
    },
    [campaigns],
  )

  // Arriving from the strip at the top of another screen: open that timer.
  const wantedTimer = (location.state as { openTimer?: string } | null)?.openTimer ?? null
  useEffect(() => {
    if (wantedTimer === null || !loaded) return
    const account = accounts.find((a) => a.id === wantedTimer)
    if (account) openTimer(account)
    // Consumed, so coming back to Now later does not reopen it.
    void navigate('.', { replace: true, state: null })
  }, [wantedTimer, loaded, accounts, openTimer, navigate])

  const markOneEdited = useCallback(async () => {
    setEditBusy(true)
    try {
      // Same set the backlog line counts: nothing from a deleted campaign.
      const live = new Set(campaigns.map((c) => c.id))
      const filmed = videos
        .filter((v) => v.phase === 'filmed' && live.has(v.campaign_id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      const next = filmed[0]
      if (!next) return
      await data.advanceVideoPhase(next.id, { session: 'edit' })
      await reload()
    } finally {
      setEditBusy(false)
    }
  }, [campaigns, data, reload, videos])

  if (!loaded) return null

  return (
    // Keyed on the stage, so each step of the flow arrives on the settle
    // spring instead of snapping in.
    <section
      key={stage.kind}
      // The console gets a laptop's width; every other step stays a column.
      className={`settle-in mx-auto flex w-full flex-col gap-6 ${stage.kind === 'console' ? 'max-w-6xl' : 'max-w-3xl'}`}
    >
      {stage.kind === 'home' ? (
        <>
          <Header
            summary={summary}
            streak={postingStreak(posts)}
            workDay={workDay}
            onOpenWork={() => setStage({ kind: 'work' })}
          />
          <EditBacklog count={summary.editBacklog} busy={editBusy} onMarkEdited={markOneEdited} />
          <div className="grid grid-cols-2 gap-3">
            {/* FILM is the one thing on this screen that starts work, so it is
                the only lit thing on it. */}
            <ActionTile
              lit
              icon={<FilmIcon className="h-6 w-6" />}
              label="FILM"
              onClick={() => setStage({ kind: 'pick_campaign' })}
            />
            <ActionTile icon={<PostIcon className="h-6 w-6" />} label="POST" to="/post" />
          </div>
          <WarmupList
            accounts={warmupAccounts}
            campaigns={campaigns}
            warmupEvents={warmupEvents}
            onPick={openTimer}
            payRank={payRank}
          />
        </>
      ) : stage.kind === 'pick_campaign' ? (
        <CampaignPicker
          campaigns={campaigns}
          onPick={(campaign) => setStage({ kind: 'briefing', campaign })}
          onBack={() => setStage({ kind: 'home' })}
        />
      ) : stage.kind === 'work' ? (
        <WorkTimer
          day={workDay}
          onChange={changeWork}
          onBack={() => setStage({ kind: 'home' })}
        />
      ) : stage.kind === 'briefing' ? (
        <Briefing
          key={stage.campaign.id}
          campaign={stage.campaign}
          onStart={(goal) => void beginConsole(stage.campaign, goal)}
          onBack={() => setStage({ kind: 'pick_campaign' })}
        />
      ) : stage.kind === 'console' ? (
        <Console
          key={stage.workSessionId}
          campaign={stage.campaign}
          goal={stage.goal}
          workSessionId={stage.workSessionId}
          onFinish={() => {
            void data.endWorkSession(stage.workSessionId)
            void reload()
            setStage({ kind: 'home' })
          }}
        />
      ) : (
        <WarmupTimer
          key={stage.account.id}
          account={stage.account}
          campaign={stage.campaign}
          onDone={async () => {
            await timers.complete(stage.account.id)
            setStage({ kind: 'home' })
          }}
          onCancel={() => {
            timers.cancel(stage.account.id)
            setStage({ kind: 'home' })
          }}
          onBack={() => setStage({ kind: 'home' })}
        />
      )}
    </section>
  )
}

/** The size both of the header's figures are set at. Fluid, because the
 *  clock and "0 of 1" at a fixed size do not both fit a 375px screen - the
 *  clock once quietly overflowed its own column and painted over the score. */
const HEADLINE_SIZE = 'clamp(1.75rem, 8.4vw, 2.75rem)'

/** The day, as an instrument: the time on the left, the score on the right,
 *  and one segment per deliverable owed underneath. No box around it - the
 *  numbers are the heaviest thing on the screen, and that is the whole
 *  hierarchy. */
function Header({
  summary,
  streak,
  workDay,
  onOpenWork,
}: {
  summary: ReturnType<typeof summariseToday>
  streak: Streak
  workDay: WorkDay
  onOpenWork: () => void
}) {
  const [now, setNow] = useState(() => new Date())
  const working = isRunning(workDay)

  useEffect(() => {
    // Every second while the clock is running, so the figure beside the time
    // actually moves; every half minute otherwise, which is all the wall clock
    // needs.
    const timer = window.setInterval(() => setNow(new Date()), working ? 1000 : 30_000)
    return () => window.clearInterval(timer)
  }, [working])

  const worked = elapsedMs(workDay, now.getTime())
  const done = summary.owed > 0 && summary.posted >= summary.owed

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        {/* shrink-0, so the clock keeps its own width rather than collapsing
            under a nowrap time that then spills over the score - and w-min,
            so the column is only as wide as the clock itself. Without it the
            caption set the width: "TUE, SEP 22 · 1 DAY RUNNING" on one line
            pushed "1 of 1" off the right edge of a 375px screen. The caption
            wraps under the clock instead. */}
        <div className="w-min shrink-0 sm:w-auto">
          {/* The time is the way into the work clock - he asked for it there
              rather than as another button on a screen he wants bare. */}
          <button
            type="button"
            onClick={onOpenWork}
            aria-label={working ? `Working - ${formatElapsed(worked)}` : 'Start working'}
            className="press -mx-1 rounded-lg px-1 text-left active:bg-surface"
          >
            <span
              className="numeric block whitespace-nowrap font-semibold leading-none text-text"
              style={{ fontSize: HEADLINE_SIZE }}
            >
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </button>
          <p className="label mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-state-later">
            <span>{now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            {streak.days > 0 ? (
              <>
                <span aria-hidden>·</span>
                {/* Green once today is kept, white while it is still the thing
                    to do. Both are states the rest of the app already uses -
                    a streak is a fact counted from the log, not a badge. */}
                <span className={streak.includesToday ? 'text-state-posted' : 'text-state-now'}>
                  {streak.days} day{streak.days === 1 ? '' : 's'} running
                </span>
              </>
            ) : null}
          </p>
          {worked > 0 || working ? (
            // Running is the thing happening now; a paused stretch he has not
            // come back to is grey like anything else waiting.
            <p
              className={`numeric mt-1.5 flex items-center gap-2 text-base font-semibold leading-none ${
                working ? 'text-state-now' : 'text-state-later'
              }`}
            >
              <StateDot tone={working ? 'now' : 'later'} />
              {formatElapsed(worked)}
            </p>
          ) : null}
        </div>

        {/* Gives way rather than holding width for its caption: the caption
            wraps and both figures stay whole. The hairline is structure, not
            signal - without it two big tabular figures side by side read as
            one run of digits, "08:17 PM 0 of 1". */}
        <div className="min-w-0 flex-1 border-l border-rule pl-4 text-right">
          <p className="numeric whitespace-nowrap font-semibold leading-none" style={{ fontSize: HEADLINE_SIZE }}>
            {/* Green only once the day is actually filled - it is the same
                "posted" state the boxes use, not a flourish. */}
            <span className={done ? 'text-state-posted' : 'text-text'}>{summary.posted}</span>
            <span className="text-state-later"> of {summary.owed}</span>
          </p>
          <p className="label mt-2.5 text-state-later">
            posted today
            {summary.runwayDays === null ? '' : ` · ${summary.runwayDays}d banked`}
          </p>
        </div>
      </div>

      {summary.owed > 0 ? <DayBar posted={summary.posted} owed={summary.owed} done={done} /> : null}
    </header>
  )
}

/** The day's deliverables, one segment each, lit green as each goes out -
 *  the same two numbers as above, readable from across the room. A day owing
 *  more than a dozen is drawn as one continuous bar, because segments that
 *  thin stop reading as individual things. */
function DayBar({ posted, owed, done }: { posted: number; owed: number; done: boolean }) {
  if (owed > 12) {
    return (
      <div aria-hidden className="h-1 overflow-hidden rounded-full bg-rule">
        <div
          className={`h-full rounded-full transition-[width] duration-700 [transition-timing-function:var(--ease-settle)] ${
            done ? 'cleared bg-state-posted' : 'bg-state-posted'
          }`}
          style={{ width: `${Math.min(100, (posted / owed) * 100)}%` }}
        />
      </div>
    )
  }
  return (
    <div aria-hidden className={`flex gap-1.5 ${done ? 'cleared rounded-full' : ''}`}>
      {Array.from({ length: owed }, (_, index) => (
        <span
          key={index}
          className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
            index < posted ? 'bg-state-posted' : 'bg-rule'
          }`}
        />
      ))}
    </div>
  )
}

/** Filmed videos waiting on an edit are one tap away from being edited - no
 *  goal, no timer, no campaign to pick. It advances the oldest one, so the
 *  backlog drains in the order it was filmed rather than growing a tail. */
function EditBacklog({
  count,
  busy,
  onMarkEdited,
}: {
  count: number
  busy: boolean
  onMarkEdited: () => void
}) {
  if (count === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 border-y border-rule py-2">
      <p className="text-base text-text">{count} filmed, ready to edit</p>
      <Button onClick={onMarkEdited} disabled={busy} className="shrink-0">
        {busy ? '·' : 'Mark edited'}
      </Button>
    </div>
  )
}

/** Back to where he came from - a quiet line of text, never competing with
 *  the thing the screen is for. */
function BackButton({ onClick, children = 'Back' }: { onClick: () => void; children?: string }) {
  return (
    <Button variant="ghost" onClick={onClick} className="self-start !px-2">
      <BackIcon className="h-4 w-4" />
      {children}
    </Button>
  )
}

/** FILM: which campaign. Every campaign is offered - an account still warming
 *  up is a reason to be careful about posting, never a reason the app should
 *  refuse to let him film. */
function CampaignPicker({
  campaigns,
  onPick,
  onBack,
}: {
  campaigns: Campaign[]
  onPick: (campaign: Campaign) => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onBack} />
      <SectionLabel>Which campaign?</SectionLabel>

      {campaigns.length === 0 ? (
        <p className="text-base text-state-later">
          No campaigns yet. Add one on <Link to="/campaigns" className="text-state-now underline underline-offset-4">BRIEFS</Link>.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <button
                type="button"
                onClick={() => onPick(campaign)}
                className="press flex min-h-[4.25rem] w-full items-center justify-between gap-3 text-left active:bg-surface"
              >
                <span className="display min-w-0 truncate text-2xl text-text">{campaign.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-state-later">
                  <span className="numeric text-base">
                    {campaign.pay_per_video_cents === null
                      ? 'no rate yet'
                      : formatCents(campaign.pay_per_video_cents)}
                  </span>
                  <ChevronRightIcon className="h-5 w-5" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The never-do list and a goal, read once right before the camera comes out. */
function Briefing({
  campaign,
  onStart,
  onBack,
}: {
  campaign: Campaign
  onStart: (goal: number) => void
  onBack: () => void
}) {
  const data = useData()
  const [rules, setRules] = useState<CampaignRule[] | null>(null)
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [typedGoal, setTypedGoal] = useState('')

  useEffect(() => {
    let cancelled = false
    void data.listCampaignRules(campaign.id).then((next) => {
      if (!cancelled) setRules(next)
    })
    return () => {
      cancelled = true
    }
  }, [campaign.id, data])

  if (rules === null) return null

  const chosen = typedGoal.trim() === '' ? goal : Number(typedGoal)

  return (
    <div className="flex flex-col gap-6">
      <BackButton onClick={onBack}>Pick a different campaign</BackButton>
      <h2 className="display text-4xl text-text">{campaign.name}</h2>

      {rules.length > 0 ? (
        <div className="flex flex-col gap-3">
          <SectionLabel tone="blocked" as="h3">
            Never do
          </SectionLabel>
          <div className="flex flex-col gap-2.5">
            {rules.map((rule) => (
              <p key={rule.id} className="border-l border-state-blocked/70 pl-3 text-base leading-snug text-text">
                {rule.body}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <SectionLabel as="h3">How many to film?</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {GOAL_PRESETS.map((preset) => {
            const on = goal === preset && typedGoal === ''
            return (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setGoal(preset)
                  setTypedGoal('')
                }}
                aria-pressed={on}
                className={[
                  'press numeric min-h-[3.75rem] rounded-xl border text-2xl font-semibold',
                  on ? 'border-state-now bg-surface text-state-now' : 'border-edge text-text-dim active:bg-surface',
                ].join(' ')}
              >
                {preset}
              </button>
            )
          })}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={typedGoal}
          onChange={(event) => setTypedGoal(event.target.value)}
          aria-label="or type a number"
          placeholder="or type a number"
          className={`${INPUT_CLASS} w-full`}
        />
      </div>

      <Button
        variant="now"
        size="big"
        onClick={() => onStart(chosen)}
        disabled={typedGoal.trim() !== '' && Number(typedGoal) <= 0}
      >
        Start filming
      </Button>
    </div>
  )
}

/** Every account, in the order he should warm them.
 *
 *  It began as a button reading "Warm up 2 accounts", became a list of the
 *  not-ready ones, then grew the ready ones too - "just to make sure i keep
 *  them fresh and remember". It was then grouped by campaign, which read well
 *  but put an account nobody had touched in a month wherever its campaign's
 *  name happened to sort. He asked for priority instead: brand-new accounts
 *  and ones left alone for a long time on top and red, accounts that are ready
 *  and recently kept fresh at the bottom.
 *
 *  So the order is the point, and the campaign is said on each row rather
 *  than being what the list is organised by. See warmupTier for the tiers.
 *
 *  It is still a daily checklist: an account warmed today is done, goes green
 *  under its own heading at the very end, and stops counting as "left". Red
 *  keeps its meaning - stopped, with the reason in plain words - because a new
 *  or neglected account is exactly what holds a campaign off the Post tab or
 *  gets an account throttled, and every red row says which of the two it is.
 *
 *  Rows rather than cards: he picked the network view's language for every
 *  screen, and a run of boxed cards was the heaviest thing on this one. Each
 *  row still stands on its own - a state dot, the platform large, the reason
 *  in its state colour, generous room above and below - so a run of them does
 *  not read as one block of text, which is what the old shared box did. */
function WarmupList({
  accounts,
  campaigns,
  warmupEvents,
  onPick,
  payRank,
}: {
  accounts: CampaignAccount[]
  campaigns: Campaign[]
  warmupEvents: WarmupEvent[]
  onPick: (account: CampaignAccount) => void
  /** Campaign id -> how well it pays, 0 being the best. */
  payRank: ReadonlyMap<string, number>
}) {
  // Read once per mount rather than every render: "now" for the tiers only
  // has to be as fresh as the list itself.
  const [now] = useState(() => Date.now())

  if (accounts.length === 0) return null

  const today = localToday()
  const nameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))

  const lastById = new Map(
    accounts.map((account) => [account.id, lastWarmupAt(account.id, warmupEvents)]),
  )
  const lastOf = (account: CampaignAccount) => lastById.get(account.id) ?? null
  const warmedToday = (account: CampaignAccount): boolean => {
    const last = lastOf(account)
    return last !== null && localToday(new Date(last)) === today
  }

  const platformRank = (platform: string) => {
    const index = (KNOWN_PLATFORMS as readonly string[]).indexOf(platform)
    return index === -1 ? KNOWN_PLATFORMS.length : index
  }

  /** Inside a group: the campaign that pays best first, then whichever needs
   *  it most (new before neglected, longest left alone first), then campaign
   *  name and the platform picker's order so the list does not shuffle between
   *  renders. The groups themselves stay by urgency - red, amber, grey - and
   *  pay orders each of them. */
  const prioritised = (list: CampaignAccount[]) =>
    [...list].sort(
      (a, b) =>
        (payRank.get(a.campaign_id) ?? Number.MAX_SAFE_INTEGER) -
          (payRank.get(b.campaign_id) ?? Number.MAX_SAFE_INTEGER) ||
        compareWarmupPriority(
          { account: a, last: lastOf(a) },
          { account: b, last: lastOf(b) },
        ) ||
        (nameById.get(a.campaign_id) ?? '').localeCompare(nameById.get(b.campaign_id) ?? '') ||
        platformRank(a.platform) - platformRank(b.platform),
    )

  const todo = accounts.filter((account) => !warmedToday(account))
  const done = accounts.filter(warmedToday)

  const urgent = prioritised(todo.filter((a) => warmupTier(a, lastOf(a), now) === 'urgent'))
  const building = prioritised(todo.filter((a) => warmupTier(a, lastOf(a), now) === 'building'))
  const ready = prioritised(todo.filter((a) => warmupTier(a, lastOf(a), now) === 'ready'))

  type Group = 'urgent' | 'building' | 'ready' | 'done'

  /** Each group's state. Colour here is only ever the state: red is stopped
   *  and says why, amber is part-way, grey is fine, green is done. */
  const toneOf: Record<Group, Tone> = {
    urgent: 'blocked',
    building: 'waiting',
    ready: 'later',
    done: 'posted',
  }

  let order = 0

  const row = (account: CampaignAccount, group: Group) => {
    const warming = needsWarmup(account)
    const sessions = warmupCompletions(account.id, warmupEvents)
    const last = lastOf(account)
    const tone = toneOf[group]

    // Every colour here is a state, and the red ones say why in words.
    const reason =
      group === 'done'
        ? 'warmed'
        : group === 'urgent'
          ? account.status === 'new'
            ? 'New - not warmed yet'
            : last === null
              ? 'Never warmed'
              : `Not warmed in ${daysSince(last, now)} days`
          : group === 'building'
            ? last === null
              ? 'in progress'
              : sinceLabel(last, now)
            : last === null
              ? 'never warmed'
              : sinceLabel(last, now)

    return (
      <li key={account.id} className="settle-in" style={{ '--i': order++ } as CSSProperties}>
        <button
          type="button"
          onClick={() => onPick(account)}
          className="press block w-full py-4 text-left active:bg-surface"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <StateDot tone={tone} />
              <span className="text-lg font-semibold leading-tight text-text">{account.platform}</span>
              <PlatformGlyph platform={account.platform} className="h-4 w-4 shrink-0 text-state-later" />
            </span>
            <span className={`flex shrink-0 items-center gap-1.5 ${TONE_TEXT[tone]}`}>
              {group === 'done' ? <CheckIcon className="h-4 w-4" strokeWidth={2} /> : null}
              <span className={`text-sm font-semibold ${TONE_TEXT[tone]}`}>{reason}</span>
            </span>
          </span>

          <span className="mt-1 block break-all pl-5 text-base text-text-dim">
            {account.handle ?? 'no handle saved'}
          </span>

          <span className="mt-2 flex items-center justify-between gap-3 pl-5">
            <span className="meta min-w-0 truncate text-state-later">
              {nameById.get(account.campaign_id) ?? 'unknown campaign'}
            </span>
            <span className="meta flex shrink-0 items-center gap-2 text-state-later">
              {warming ? (
                <>
                  {/* Sessions as pips, so "1 of 2" is seen rather than read. */}
                  <span aria-hidden className="flex gap-1">
                    {Array.from({ length: WARMUP_SESSIONS_REQUIRED }, (_, index) => (
                      <span
                        key={index}
                        className={`h-1 w-5 rounded-full ${index < sessions ? 'bg-state-posted' : 'bg-edge-lit'}`}
                      />
                    ))}
                  </span>
                  <span className="numeric">
                    {sessions} of {WARMUP_SESSIONS_REQUIRED}
                  </span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <span>{warmupMinutesFor(account)} min</span>
            </span>
          </span>
        </button>
      </li>
    )
  }

  const group = (heading: string, list: CampaignAccount[], kind: Group) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <SectionLabel tone={toneOf[kind]} as="h3">
          {heading}
        </SectionLabel>
        <ul className="grid divide-y divide-rule sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
          {list.map((account) => row(account, kind))}
        </ul>
      </div>
    )

  return (
    <div className="flex flex-col gap-6">
      {todo.length > 0 ? (
        <div className="flex flex-col gap-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-text-dim">
            {`Keep them warm - ${todo.length} left`}
          </h2>
          {group(`Warm these first - ${urgent.length}`, urgent, 'urgent')}
          {group('Warming up', building, 'building')}
          {group('Ready - keeping them fresh', ready, 'ready')}
        </div>
      ) : null}
      {done.length > 0 ? group('Warmed today', prioritised(done), 'done') : null}
    </div>
  )
}

/** "today", "yesterday", "4d ago". Whole days only - the point is remembering
 *  roughly how long an account has been left alone, not timing it. */
function sinceLabel(iso: string, now = Date.now()): string {
  const days = daysSince(iso, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

/** The work clock: start it, watch it, leave it running.
 *
 *  Nothing here is a budget and nothing is compared against a plan - that is
 *  the timer he had removed from the filming path. This one only reports.
 *  It keeps running when he leaves: the elapsed figure moves to the home
 *  screen beside the wall clock, and a reload picks it up where it was,
 *  because what is stored is when the stretch began rather than a number
 *  something has to keep ticking.
 *
 *  The milestones are the game. Passing thirty minutes is a state, so it is
 *  allowed a colour; they are not badges collected for their own sake, and
 *  nothing is unlocked by them. */
function WorkTimer({
  day,
  onChange,
  onBack,
}: {
  day: WorkDay
  onChange: (next: WorkDay) => void
  onBack: () => void
}) {
  const running = isRunning(day)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const worked = elapsedMs(day, now)
  const reached = MILESTONES_MS.filter((ms) => worked >= ms).length

  return (
    <div className="flex flex-col gap-7">
      <SectionLabel>Time at the desk today</SectionLabel>

      <p
        aria-live="off"
        aria-label="Time worked today"
        className={[
          'numeric text-center font-semibold leading-none',
          running ? 'text-state-now' : 'text-state-later',
        ].join(' ')}
        style={{ fontSize: 'clamp(3.5rem, 18vw, 5rem)' }}
      >
        {formatElapsed(worked)}
      </p>

      {/* Four marks, lighting as the evening goes. The only scoreboard the
          app keeps that is about him rather than about the work. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-center gap-1.5">
          {MILESTONES_MS.map((ms) => (
            <span
              key={ms}
              aria-hidden
              className={[
                'h-1 flex-1 rounded-full transition-colors duration-500',
                worked >= ms ? 'bg-state-posted' : 'bg-rule',
              ].join(' ')}
            />
          ))}
        </div>
        <p className="text-center label text-state-later">
          {reached === 0 ? '30m · 1h · 2h · 3h' : `${reached} of ${MILESTONES_MS.length} marks`}
        </p>
      </div>

      <Button
        variant={running ? 'quiet' : 'now'}
        size="big"
        onClick={() => onChange(running ? pauseWork(day) : startWork(day))}
        className="!tracking-[0.2em]"
      >
        {running ? 'PAUSE' : worked > 0 ? 'BACK TO WORK' : 'START WORKING'}
      </Button>

      <Button variant="ghost" onClick={onBack}>
        {running ? 'Leave it running' : 'Back'}
      </Button>

      {worked > 0 && !running ? (
        <button
          type="button"
          onClick={() => onChange(resetWork(day))}
          className="self-center text-sm text-state-later underline-offset-4 active:underline"
        >
          Clear today
        </button>
      ) : null}
    </div>
  )
}

/** How long a session runs, offered as quick choices alongside the account's
 *  own default (5 minutes ready, 15 building) - he picks it once, before the
 *  clock starts, rather than being stuck with what the account's status
 *  would otherwise pick for him. Deduplicated and sorted, so the default
 *  never appears twice when it is already one of the presets. */
function warmupMinuteChoices(account: CampaignAccount): number[] {
  const usual = warmupMinutesFor(account)
  return [...new Set([1, 3, usual, 5, 10, 15, 20, 30])].sort((a, b) => a - b)
}

/** Whose warm-up this is: platform, handle, campaign. Shared by both halves
 *  of the timer so the account never changes shape when the clock starts. */
function WarmupWho({ account, campaign }: { account: CampaignAccount; campaign: Campaign | null }) {
  return (
    <div className="flex items-start gap-3">
      <PlatformGlyph platform={account.platform} className="mt-1 h-6 w-6 shrink-0 text-state-later" />
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold leading-tight text-text">
          {account.platform}
          <span className="ml-2 break-all text-lg font-normal text-state-later">
            {account.handle ?? 'no handle saved'}
          </span>
        </h2>
        <p className="meta mt-1 text-state-later">{campaign?.name ?? 'unknown campaign'}</p>
      </div>
    </div>
  )
}

/** The countdown as a ring that empties, with the time inside it. The ring
 *  is the same thin line the network view draws with; it is white while the
 *  clock runs and green once the time is up. */
function CountdownRing({ left, total, children }: { left: number; total: number; children: ReactNode }) {
  const finished = left === 0
  const remaining = total > 0 ? left / total : 0
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[17rem]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke="var(--color-rule)" strokeWidth="1.25" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={finished ? 'var(--color-state-posted)' : 'var(--color-state-now)'}
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset={1 - remaining}
          // One second per tick, linear: the ring moves continuously rather
          // than jumping once a second.
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

/** The account to warm up. Before the clock starts, this is a choice of how
 *  long - his own default preselected, changeable with one tap or by typing
 *  a number - and after, the countdown. Nothing here touches the video
 *  pipeline - warming up is using the account itself, not filming anything. */
function WarmupTimer({
  account,
  campaign,
  onDone,
  onCancel,
  onBack,
}: {
  account: CampaignAccount
  campaign: Campaign | null
  onDone: () => Promise<void>
  onCancel: () => void
  onBack: () => void
}) {
  const { timers, now, setViewing, start } = useWarmupTimers()
  const [busy, setBusy] = useState(false)
  const usual = warmupMinutesFor(account)
  const [minutes, setMinutes] = useState(usual)

  // The strip at the top of the page shows every timer except the one filling
  // this screen, so it is not on screen twice.
  useEffect(() => {
    setViewing(account.id)
    return () => setViewing(null)
  }, [account.id, setViewing])

  // The timer belongs to the app shell, not to this screen: what is left is
  // read off its end time, so it is right however long he was elsewhere.
  const timer = timers.find((t) => t.accountId === account.id)

  const handleDone = useCallback(async () => {
    setBusy(true)
    try {
      await onDone()
    } finally {
      setBusy(false)
    }
  }, [onDone])

  // Reopened from the strip, or tapped a second time: a timer is already
  // running, so there is nothing left to choose - straight to the countdown.
  if (!timer) {
    const parsed = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : null

    return (
      <div className="flex flex-col gap-6">
        <BackButton onClick={onBack} />
        <WarmupWho account={account} campaign={campaign} />

        <div className="flex flex-col gap-3">
          <SectionLabel as="h3">How long</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {warmupMinuteChoices(account).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setMinutes(choice)}
                aria-pressed={minutes === choice}
                aria-label={`${choice} min${choice === usual ? ' - usual' : ''}`}
                className={[
                  'press flex min-h-[3.75rem] flex-col items-center justify-center rounded-xl border',
                  minutes === choice
                    ? 'border-state-now bg-surface text-state-now'
                    : 'border-edge text-text-dim active:bg-surface',
                ].join(' ')}
              >
                <span className="numeric text-xl font-semibold leading-none">{choice}</span>
                <span className="mt-1 text-xs leading-none">{choice === usual ? 'usual' : 'min'}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3">
            <span className="label text-state-later">Or type one</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              aria-label="Minutes to warm up for"
              className={`${INPUT_CLASS} w-24`}
            />
          </label>
        </div>

        <Button
          variant="now"
          size="big"
          disabled={parsed === null}
          onClick={() => {
            if (parsed === null) return
            start(account, campaign?.name ?? 'unknown campaign', parsed)
          }}
        >
          Start - {parsed ?? '?'} min
        </Button>
      </div>
    )
  }

  const left = secondsLeft(timer, now)
  const finished = left === 0

  return (
    <div className="flex flex-col gap-6">
      <BackButton onClick={onBack}>Back - the timer keeps running</BackButton>
      <WarmupWho account={account} campaign={campaign} />

      <CountdownRing left={left} total={timer.minutes * 60}>
        <p
          className={`numeric font-semibold leading-none ${finished ? 'text-state-posted' : 'text-text'}`}
          style={{ fontSize: 'clamp(3rem, 15vw, 4rem)' }}
          aria-live="polite"
        >
          {formatClock(left)}
        </p>
        <p className="label mt-3 text-state-later">{timer.minutes} min</p>
      </CountdownRing>

      <p className="text-center text-base text-text-dim">
        {finished
          ? "Time's up."
          : needsWarmup(account)
            ? 'Use the account normally until this runs out.'
            : 'Scroll the feed until this runs out - just enough to keep it alive.'}
      </p>

      <Button
        variant={finished ? 'posted' : 'now'}
        size="big"
        onClick={() => void handleDone()}
        disabled={busy}
      >
        Mark warmed up
      </Button>

      {finished ? null : (
        <Button variant="ghost" onClick={onCancel}>
          Cancel this timer
        </Button>
      )}
    </div>
  )
}
