// The home screen: what today owes, what is filmed, and one way into filming.
//
// What used to be here and is not any more: a session-type chooser, a "how
// long tonight" window picker, an EDIT console, a POST session and a planner
// that packed an evening for him. He asked for a target and a scoreboard, and
// every one of those was a decision standing between him and the camera.
//
// What is left is: the day's count, one tap to mark a filmed video edited,
// FILM against a goal, and warm-up.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Streak } from '../data/streak'
import { KNOWN_PLATFORMS } from '../components/AccountsEditor'
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

export function Now() {
  const data = useData()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [posts, setPosts] = useState<VideoPost[]>([])
  const [warmupEvents, setWarmupEvents] = useState<WarmupEvent[]>([])
  const [accounts, setAccounts] = useState<CampaignAccount[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'home' })
  /** Read from storage on mount, so leaving the page - or reloading, or
   *  closing the tab - never loses the stretch he is in. */
  const [workDay, setWorkDay] = useState<WorkDay>(() => readWorkDay())

  const changeWork = useCallback((next: WorkDay) => {
    writeWorkDay(next)
    setWorkDay(next)
  }, [])

  const reload = useCallback(async () => {
    const [nextCampaigns, nextVideos, nextWarmupEvents, nextAccounts] = await Promise.all([
      data.listCampaigns(),
      data.listVideos(),
      data.listWarmupEvents(),
      data.listCampaignAccounts(),
    ])
    const nextPosts = (
      await Promise.all(nextVideos.map((video) => data.listVideoPosts(video.id)))
    ).flat()

    setCampaigns(nextCampaigns)
    setVideos(nextVideos)
    setPosts(nextPosts)
    setWarmupEvents(nextWarmupEvents)
    setAccounts(nextAccounts)
  }, [data])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Raise today's obligation as rows before anything is counted, so the
      // "X of Y" line is not briefly wrong.
      await ensureTodaysQuota(data)
      if (cancelled) return
      await reload()
      if (!cancelled) setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [data, reload])

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

  const recordWarmup = useCallback(
    async (account: CampaignAccount) => {
      await data.recordWarmupEvent(account.id, warmupMinutesFor(account))
      await reload()
    },
    [data, reload],
  )

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
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      {stage.kind === 'home' ? (
        <>
          <Header
            summary={summary}
            streak={postingStreak(posts)}
            workDay={workDay}
            onOpenWork={() => setStage({ kind: 'work' })}
          />
          <EditBacklog count={summary.editBacklog} busy={editBusy} onMarkEdited={markOneEdited} />
          <div className="grid grid-cols-2 gap-2">
            {/* FILM is the one thing on this screen that starts work, so it is
                the only lit thing on it. */}
            <button
              type="button"
              onClick={() => setStage({ kind: 'pick_campaign' })}
              className="lit min-h-tap rounded-xl border border-state-now/70 bg-surface-raised px-4 text-lg font-semibold tracking-[0.2em] text-state-now transition-transform duration-100 active:scale-[0.98] active:bg-surface"
            >
              FILM
            </button>
            <Link
              to="/post"
              className="flex min-h-tap items-center justify-center rounded-xl border border-edge bg-surface px-4 text-lg font-semibold tracking-[0.2em] text-text transition-transform duration-100 active:scale-[0.98] active:bg-surface-raised"
            >
              POST
            </Link>
          </div>
          <WarmupList
            accounts={warmupAccounts}
            campaigns={campaigns}
            warmupEvents={warmupEvents}
            onPick={(account) =>
              setStage({
                kind: 'warmup_timer',
                account,
                campaign: campaigns.find((c) => c.id === account.campaign_id) ?? null,
              })
            }
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
            await recordWarmup(stage.account)
            setStage({ kind: 'home' })
          }}
          onBack={() => setStage({ kind: 'home' })}
        />
      )}
    </section>
  )
}

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
    <header className="relative overflow-hidden rounded-2xl border border-edge bg-gradient-to-b from-surface-raised to-surface px-4 py-3">
      {/* A hairline catching the light along the top of the card. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-edge-lit/70" />

      <div className="flex items-end justify-between gap-3">
        {/* shrink-0, so the clock keeps its own width. It was min-w-0, which
            let the column collapse narrower than the time inside it - and a
            nowrap span in a too-small box does not wrap, it just spills over
            whatever sits to its right. */}
        <div className="shrink-0">
          {/* The time is the way into the work clock - he asked for it there
              rather than as another button on a screen he wants bare. */}
          <button
            type="button"
            onClick={onOpenWork}
            aria-label={working ? `Working - ${formatElapsed(worked)}` : 'Start working'}
            className="flex items-baseline gap-2 rounded-md text-left active:bg-surface"
          >
            {/* Fluid, because "03:00 PM" and "0 of 1" at a fixed 36px do not
                both fit a 375px screen - the clock was quietly overflowing
                its own column and painting over what sat beside it. */}
            <span
              className="numeric whitespace-nowrap font-semibold leading-none text-text"
              style={{ fontSize: 'clamp(1.5rem, 7.4vw, 2.25rem)' }}
            >
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {worked > 0 || working ? (
              <span
                className={[
                  'numeric whitespace-nowrap text-lg font-semibold leading-none',
                  // Running is the thing happening now; a paused stretch he
                  // has not come back to is grey like anything else waiting.
                  working ? 'text-state-now' : 'text-state-later',
                ].join(' ')}
              >
                {formatElapsed(worked)}
              </span>
            ) : null}
          </button>
          <p className="mt-1.5 truncate label text-state-later">
            {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
            {streak.days > 0 ? (
              <>
                {' · '}
                {/* Green once today is kept, white while it is still the thing
                    to do. Both are states the rest of the app already uses -
                    a streak is a fact counted from the log, not a badge. */}
                <span
                  className={streak.includesToday ? 'text-state-posted' : 'text-state-now'}
                >
                  {streak.days} day{streak.days === 1 ? '' : 's'} running
                </span>
              </>
            ) : null}
          </p>
        </div>
        {/* The clock and the day's score are both big tabular figures sitting
            next to each other, and without something between them they read
            as one run of digits - "02:59 PM 0 of 1". The rule belongs to the
            score's column so it lands against it rather than floating in the
            middle of the card. It is structure, not signal: it says nothing
            about state, it just stops one number being read as the other. */}
        {/* Not shrink-0: it was holding 208px for its own caption and
            squeezing the clock into 106px, which the clock then overflowed -
            running the time underneath this very rule. It gives way now and
            lets its caption wrap instead, which costs a line and keeps both
            figures whole. */}
        <div className="min-w-0 flex-1 border-l border-edge pl-3 text-right">
          <p
            className="numeric whitespace-nowrap font-semibold leading-none"
            style={{ fontSize: 'clamp(1.5rem, 7.4vw, 2.25rem)' }}
          >
            {/* Green only once the day is actually filled - it is the same
                "posted" state the boxes use, not a flourish. */}
            <span className={done ? 'text-state-posted' : 'text-text'}>{summary.posted}</span>
            <span className="text-state-later"> of {summary.owed}</span>
          </p>
          <p className="mt-1.5 label text-state-later">
            posted today
            {summary.runwayDays === null ? '' : ` · ${summary.runwayDays}d banked`}
          </p>
        </div>
      </div>

      {/* The day, as one bar. Nothing new is being said - it is the same two
          numbers above, at a glance from across the room. */}
      {summary.owed > 0 ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${
              done ? 'bg-state-posted cleared' : 'bg-state-now'
            }`}
            style={{ width: `${Math.min(100, (summary.posted / summary.owed) * 100)}%` }}
          />
        </div>
      ) : null}
    </header>
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-3 py-2">
      <p className="text-sm text-text">{count} filmed, ready to edit</p>
      <button
        type="button"
        onClick={onMarkEdited}
        disabled={busy}
        className="min-h-tap shrink-0 rounded-md border border-edge bg-surface-raised px-3 text-sm font-semibold text-text active:bg-surface disabled:text-state-later"
      >
        {busy ? '·' : 'Mark edited'}
      </button>
    </div>
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
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
        Which campaign?
      </h2>

      {campaigns.length === 0 ? (
        <p className="text-sm text-state-later">
          No campaigns yet. Add one on <Link to="/campaigns" className="text-state-now">BRIEFS</Link>.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <button
                type="button"
                onClick={() => onPick(campaign)}
                className="flex min-h-tap w-full items-center justify-between rounded-lg border border-edge bg-surface px-3 font-semibold text-text active:bg-surface-raised"
              >
                <span className="truncate">{campaign.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-state-later">
                  {campaign.pay_per_video_cents === null
                    ? 'no rate yet'
                    : formatCents(campaign.pay_per_video_cents)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
      >
        Back
      </button>
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

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>

      {rules.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-state-blocked">
            Never do
          </h3>
          <ul className="mt-1 flex flex-col gap-1">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="border-l-2 border-state-blocked/50 pl-2 text-sm text-text"
              >
                {rule.body}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          How many to film?
        </h3>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {GOAL_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setGoal(preset)
                setTypedGoal('')
              }}
              aria-pressed={goal === preset && typedGoal === ''}
              className={[
                'min-h-tap rounded-lg border font-semibold active:bg-surface-raised',
                goal === preset && typedGoal === ''
                  ? 'border-state-now bg-surface-raised text-state-now'
                  : 'border-edge bg-surface text-text',
              ].join(' ')}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={typedGoal}
          onChange={(event) => setTypedGoal(event.target.value)}
          aria-label="or type a number"
          placeholder="or type a number"
          className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface px-3 text-text placeholder:text-state-later"
        />
      </div>

      <button
        type="button"
        onClick={() => onStart(typedGoal.trim() === '' ? goal : Number(typedGoal))}
        disabled={typedGoal.trim() !== '' && Number(typedGoal) <= 0}
        className="min-h-tap rounded-lg border border-state-now bg-surface-raised px-4 text-lg font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        Start filming
      </button>

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
      >
        Pick a different campaign
      </button>
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
 *  gets an account throttled, and every red row says which of the two it is. */
function WarmupList({
  accounts,
  campaigns,
  warmupEvents,
  onPick,
}: {
  accounts: CampaignAccount[]
  campaigns: Campaign[]
  warmupEvents: WarmupEvent[]
  onPick: (account: CampaignAccount) => void
}) {
  if (accounts.length === 0) return null

  const today = localToday()
  const now = Date.now()
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

  /** Most pressing first; a tie falls back to campaign name and the platform
   *  picker's order so the list does not shuffle between renders. */
  const prioritised = (list: CampaignAccount[]) =>
    [...list].sort(
      (a, b) =>
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

  type Tone = 'urgent' | 'building' | 'ready' | 'done'

  const row = (account: CampaignAccount, tone: Tone) => {
    const building = needsWarmup(account)
    const sessions = warmupCompletions(account.id, warmupEvents)
    const last = lastOf(account)

    // Every colour here is a state, and the red ones say why in words.
    const reason =
      tone === 'done'
        ? 'warmed'
        : tone === 'urgent'
          ? account.status === 'new'
            ? 'New - not warmed yet'
            : last === null
              ? 'Never warmed'
              : `Not warmed in ${daysSince(last, now)} days`
          : tone === 'building'
            ? last === null
              ? 'in progress'
              : sinceLabel(last)
            : last === null
              ? 'never warmed'
              : sinceLabel(last)
    const reasonClass = {
      urgent: 'text-state-blocked font-semibold',
      building: 'text-state-waiting',
      ready: 'text-state-later',
      done: 'text-state-posted',
    }[tone]

    return (
      <li key={account.id}>
        <button
          type="button"
          onClick={() => onPick(account)}
          className="flex min-h-tap w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors active:bg-surface-raised"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-hidden
              className={`w-3 shrink-0 text-center ${tone === 'done' ? 'text-state-posted' : 'text-transparent'}`}
            >
              ✓
            </span>
            {/* Platform and handle on one line that is allowed to wrap, and the
                campaign under them. Truncating the handle left it "@mi..." on a
                phone, so it wraps instead. */}
            <span className="flex min-w-0 flex-col">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`font-semibold ${tone === 'done' ? 'text-state-posted' : 'text-text'}`}
                >
                  {account.platform}
                </span>
                <span className="break-all text-sm text-state-later">
                  {account.handle ?? 'no handle saved'}
                </span>
              </span>
              <span className="meta truncate text-state-later">
                {nameById.get(account.campaign_id) ?? 'unknown campaign'}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end text-right">
            <span className={`text-sm ${reasonClass}`}>{reason}</span>
            <span className="meta flex items-baseline gap-1.5 text-state-later">
              {building ? (
                <>
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

  const group = (
    heading: string,
    headingClass: string,
    list: CampaignAccount[],
    tone: Tone,
  ) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <h3 className={`label ${headingClass}`}>{heading}</h3>
        <ul
          className={[
            'divide-y overflow-hidden rounded-xl border',
            tone === 'urgent'
              ? 'divide-state-blocked/20 border-state-blocked/50 bg-state-blocked/5'
              : tone === 'done'
                ? 'divide-state-posted/20 border-state-posted/40 bg-state-posted/5'
                : 'divide-edge border-edge bg-surface',
          ].join(' ')}
        >
          {list.map((account) => row(account, tone))}
        </ul>
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {todo.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-state-later">
            {`Keep them warm - ${todo.length} left`}
          </h2>
          {group(`Warm these first - ${urgent.length}`, 'text-state-blocked', urgent, 'urgent')}
          {group('Warming up', 'text-state-waiting', building, 'building')}
          {group('Ready - keeping them fresh', 'text-state-later', ready, 'ready')}
        </div>
      ) : null}
      {done.length > 0
        ? group('Warmed today', 'text-state-posted', prioritised(done), 'done')
        : null}
    </div>
  )
}

/** "today", "yesterday", "4d ago". Whole days only - the point is remembering
 *  roughly how long an account has been left alone, not timing it. */
function sinceLabel(iso: string): string {
  const days = daysSince(iso)
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
    <div className="flex flex-col gap-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-state-later">
        Time at the desk today
      </h2>

      <p
        aria-live="off"
        aria-label="Time worked today"
        className={[
          'numeric text-center text-6xl font-semibold leading-none',
          running ? 'text-state-now' : 'text-state-later',
        ].join(' ')}
      >
        {formatElapsed(worked)}
      </p>

      {/* Four marks, lighting as the evening goes. The only scoreboard the
          app keeps that is about him rather than about the work. */}
      <div className="flex items-center justify-center gap-2">
        {MILESTONES_MS.map((ms) => {
          const passed = worked >= ms
          return (
            <span
              key={ms}
              aria-hidden
              className={[
                'h-1.5 flex-1 rounded-full transition-colors duration-500',
                passed ? 'bg-state-posted' : 'bg-surface-raised',
              ].join(' ')}
            />
          )
        })}
      </div>
      <p className="-mt-3 text-center label text-state-later">
        {reached === 0
          ? '30m · 1h · 2h · 3h'
          : `${reached} of ${MILESTONES_MS.length} marks`}
      </p>

      <button
        type="button"
        onClick={() => onChange(running ? pauseWork(day) : startWork(day))}
        className={[
          'min-h-tap rounded-xl border px-4 text-lg font-semibold tracking-[0.2em]',
          'transition-transform duration-100 active:scale-[0.98]',
          running
            ? 'border-edge bg-surface text-text active:bg-surface-raised'
            : 'lit border-state-now/70 bg-surface-raised text-state-now active:bg-surface',
        ].join(' ')}
      >
        {running ? 'PAUSE' : worked > 0 ? 'BACK TO WORK' : 'START WORKING'}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
      >
        {running ? 'Leave it running' : 'Back'}
      </button>

      {worked > 0 && !running ? (
        <button
          type="button"
          onClick={() => onChange(resetWork(day))}
          className="text-xs text-state-later underline-offset-4 active:underline"
        >
          Clear today
        </button>
      ) : null}
    </div>
  )
}

/** The account to warm up, and a countdown. Nothing here touches the video
 *  pipeline - warming up is using the account itself, not filming anything. */
function WarmupTimer({
  account,
  campaign,
  onDone,
  onBack,
}: {
  account: CampaignAccount
  campaign: Campaign | null
  onDone: () => Promise<void>
  onBack: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => warmupMinutesFor(account) * 60)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  const handleDone = useCallback(async () => {
    setBusy(true)
    try {
      await onDone()
    } finally {
      setBusy(false)
    }
  }, [onDone])

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">
        {account.platform}
        <span className="ml-2 text-state-later">{account.handle ?? 'no handle saved'}</span>
      </h2>
      <p className="-mt-3 text-sm text-state-later">{campaign?.name ?? 'unknown campaign'}</p>

      <p className="numeric text-center text-6xl font-semibold text-text" aria-live="polite">
        {mm}:{ss}
      </p>
      <p className="text-center text-sm text-state-later">
        {secondsLeft === 0
          ? "Time's up."
          : needsWarmup(account)
            ? 'Use the account normally until this runs out.'
            : 'Scroll the feed until this runs out - just enough to keep it alive.'}
      </p>

      <button
        type="button"
        onClick={() => void handleDone()}
        disabled={busy}
        className="min-h-tap rounded-lg border border-state-now bg-surface-raised px-4 text-lg font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        Mark warmed up
      </button>

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
      >
        Back
      </button>
    </div>
  )
}
