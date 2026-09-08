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
  lastWarmupAt,
  needsWarmup,
  warmupCompletions,
  warmupMinutesFor,
} from '../data'
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
    () => summariseToday(campaigns, videos, posts),
    [campaigns, posts, videos],
  )

  // Every account, not only the ones still being built. He asked to keep all
  // of them in front of him - "just to make sure i keep them fresh and
  // remember" - with the not-ready ones first, because those are the ones
  // holding a campaign off the Post tab.
  const warmupAccounts = useMemo(
    () =>
      accounts
        .filter((account) => account.is_active)
        .sort((a, b) => {
          const byStatus = Number(needsWarmup(b)) - Number(needsWarmup(a))
          return byStatus !== 0 ? byStatus : a.platform.localeCompare(b.platform)
        }),
    [accounts],
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
          <Header summary={summary} />
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

function Header({ summary }: { summary: ReturnType<typeof summariseToday> }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const done = summary.owed > 0 && summary.posted >= summary.owed

  return (
    <header className="relative overflow-hidden rounded-2xl border border-edge bg-gradient-to-b from-surface-raised to-surface px-4 py-3">
      {/* A hairline catching the light along the top of the card. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-edge-lit/70" />

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="numeric whitespace-nowrap text-4xl font-semibold leading-none text-text">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="mt-1.5 truncate text-[10px] uppercase tracking-[0.14em] text-state-later">
            {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="numeric whitespace-nowrap text-4xl font-semibold leading-none">
            {/* Green only once the day is actually filled - it is the same
                "posted" state the boxes use, not a flourish. */}
            <span className={done ? 'text-state-posted' : 'text-text'}>{summary.posted}</span>
            <span className="text-state-later"> of {summary.owed}</span>
          </p>
          <p className="mt-1.5 whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-state-later">
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
              done ? 'bg-state-posted' : 'bg-state-now'
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
        className="min-h-tap rounded-md border border-edge bg-surface-raised px-3 text-sm font-semibold text-text active:bg-surface disabled:text-state-later"
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

/** Every account, and when each was last used.
 *
 *  It began as a button reading "Warm up 2 accounts" - a number he had to tap
 *  to find out what it meant - and became a list of the not-ready ones when he
 *  asked to see which they were. He then asked for the rest as well: "keep a
 *  warmup section for all accounts just to make sure i keep them fresh and
 *  remember". So a ready account is here too, not because it needs promoting
 *  but because an account nobody touches goes stale.
 *
 *  Not-ready accounts sort first and read amber, because those are the ones
 *  holding a campaign off the Post tab. A ready one is grey and says how long
 *  it has been left alone, which is the whole of the remembering. */
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

  const nameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))

  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-state-later">
        Keep them warm
      </h2>
      <ul className="flex flex-col gap-1.5">
        {accounts.map((account) => {
          const building = needsWarmup(account)
          const done = warmupCompletions(account.id, warmupEvents)
          const last = lastWarmupAt(account.id, warmupEvents)
          return (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => onPick(account)}
                className={[
                  'flex min-h-tap w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 text-left',
                  'transition-transform duration-100 active:scale-[0.99] active:bg-surface-raised',
                  building ? 'border-state-waiting/40' : 'border-edge',
                ].join(' ')}
              >
                <span className="truncate">
                  <span className="font-semibold text-text">{account.platform}</span>
                  <span className="ml-2 text-sm text-state-later">
                    {account.handle ?? 'no handle saved'} ·{' '}
                    {nameById.get(account.campaign_id) ?? 'unknown campaign'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {building ? (
                    <span className="numeric text-sm text-state-waiting">
                      {done} of {WARMUP_SESSIONS_REQUIRED}
                    </span>
                  ) : (
                    <span className="text-sm text-state-later">
                      {last === null ? 'never warmed' : sinceLabel(last)}
                    </span>
                  )}
                  <span className="block text-[10px] uppercase tracking-[0.14em] text-state-later">
                    {warmupMinutesFor(account)} min
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** "today", "yesterday", "4d ago". Whole days only - the point is remembering
 *  roughly how long an account has been left alone, not timing it. */
function sinceLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
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
