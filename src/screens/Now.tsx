import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { VideoRow } from '../components/VideoRow'
import type {
  BonusClaim,
  BonusTier,
  Campaign,
  CampaignAccount,
  CampaignRule,
  SessionType,
  TimeEstimate,
  Video,
  WarmupEvent,
} from '../data'
import { WARMUP_SESSIONS_REQUIRED, localToday, needsWarmup, warmupCompletions } from '../data'
import { ensureTodaysQuota, summariseToday } from '../data/today'
import { useData } from '../data/useData'
import { readyAtFromEvents, fitSession } from '../fitting/fit'
import { materialiseSupply } from '../fitting/supply'
import { SESSION_PHASE, formatCents, formatMinutes, stageMinutes } from '../session'
import { useSession } from '../session/useSession'
import { Console } from './Console'

/** FILM is worked one campaign at a time: he picks which campaign before
 *  anything is packed, sees its do/don't list at a glance, and only that
 *  campaign's work fills the console. WARM-UP never touches the video
 *  pipeline at all - it is a timer against an account, not a session full of
 *  videos - so it gets its own stages entirely.
 *
 *  EDIT and POST used to live here too, each behind their own goal-and-timer
 *  setup. Both were noise: editing needed nothing but a single "mark this one
 *  edited" tap (see EditBacklog below), and posting already has its own
 *  screen at /post, keyed to platforms and handles rather than a session.
 *  There is no "how long tonight" step any more, either - he asked for a
 *  target and a scoreboard, not a clock, so FILM asks only for a goal, and
 *  nothing else asks for anything at all. */
const GOAL_PRESETS = [3, 5, 7, 10] as const
const DEFAULT_GOAL = 7

/** `work_sessions.planned_minutes` is `not null check (> 0)` in the schema,
 *  but nothing in the UI asks for a time budget any more - he only ever
 *  watches the goal count. This is bookkeeping only: a fixed placeholder so
 *  the row can be written, never surfaced or compared against anywhere. */
const FILM_SESSION_PLANNED_MINUTES = 120

/** How long a warm-up countdown runs. It used to be a preset he chose before
 *  picking a session type at all; now nothing asks, since the account only
 *  needs to be used for a while, not for an exact time he has to plan. */
const WARMUP_DEFAULT_MINUTES = 15

type Stage =
  | { kind: 'chooser' }
  | { kind: 'pick_campaign' }
  | { kind: 'briefing'; campaign: Campaign }
  | { kind: 'console'; campaign: Campaign; goal: number; workSessionId: string }
  | { kind: 'warmup_pick' }
  | { kind: 'warmup_timer'; account: CampaignAccount; campaign: Campaign | null }

export function Now() {
  const data = useData()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [estimates, setEstimates] = useState<TimeEstimate[]>([])
  const [loaded, setLoaded] = useState(false)

  const [planning, setPlanning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editBusy, setEditBusy] = useState(false)

  /** The evening in progress lives in the session context so SHOOT is walking
   *  the same list, in the same frozen order, that NOW is showing. */
  const { active, start, goTo, stop } = useSession()
  const session = active?.type ?? null

  const [switchMinutes, setSwitchMinutes] = useState(10)
  const [tiers, setTiers] = useState<BonusTier[]>([])
  const [claims, setClaims] = useState<BonusClaim[]>([])
  const [warmupEvents, setWarmupEvents] = useState<WarmupEvent[]>([])
  const [accounts, setAccounts] = useState<CampaignAccount[]>([])
  const [stage, setStage] = useState<Stage>({ kind: 'chooser' })

  const reload = useCallback(async () => {
    const [
      nextCampaigns,
      nextVideos,
      nextEstimates,
      settings,
      nextClaims,
      nextWarmupEvents,
      nextAccounts,
    ] =
      await Promise.all([
        data.listCampaigns(),
        data.listVideos(),
        data.listTimeEstimates(),
        data.getUserSettings(),
        data.listBonusClaims(),
        data.listWarmupEvents(),
        data.listCampaignAccounts(),
      ])
    const nextTiers = (
      await Promise.all(nextCampaigns.map((c) => data.listBonusTiers(c.id)))
    ).flat()

    setCampaigns(nextCampaigns)
    setVideos(nextVideos)
    setEstimates(nextEstimates)
    setSwitchMinutes(settings.setup_switch_minutes)
    setClaims(nextClaims)
    setTiers(nextTiers)
    setWarmupEvents(nextWarmupEvents)
    setAccounts(nextAccounts)
    return { nextCampaigns, nextVideos, nextEstimates, nextTiers, nextClaims }
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

  const campaignsById = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c])),
    [campaigns],
  )
  const videosById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos])

  const summary = useMemo(
    () => summariseToday(campaigns, videos),
    [campaigns, videos],
  )

  // A campaign is workable once at least one of its accounts is ready to post
  // from. A campaign with no accounts at all is still offered: it may predate
  // the accounts editor, and hiding his own campaign with no way to see why
  // would be worse than letting him film for it.
  const readyCampaigns = useMemo(
    () =>
      campaigns.filter((campaign) => {
        const mine = accounts.filter((a) => a.campaign_id === campaign.id)
        return mine.length === 0 || mine.some((a) => !needsWarmup(a))
      }),
    [accounts, campaigns],
  )

  // Exactly what he asked to see here: the accounts set new or warming up, and
  // not the ones already warmed.
  const warmupAccounts = useMemo(() => accounts.filter(needsWarmup), [accounts])

  /** Opens a sitting: a campaign and a goal, recorded so the evening can be
   *  looked back at and so every phase_event it produces says which session
   *  it belonged to. */
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

  /** The old behaviour, kept as the option it now is: packs a window with the
   *  fitting algorithm instead of him picking a goal by hand. It is the one
   *  place left that still needs a number of minutes, since the algorithm has
   *  to know how much time it is packing. */
  const runAutoPlan = useCallback(
    async (windowMinutes: number, onlyCampaign: Campaign) => {
      setPlanning(true)
      const events = await data.listPhaseEvents()
      const plan = fitSession({
        session: 'film',
        windowMinutes,
        videos,
        campaigns: [onlyCampaign],
        estimates,
        setupSwitchMinutes: switchMinutes,
        today: localToday(),
        readyAt: readyAtFromEvents(events),
        bonusTiers: tiers,
        bonusClaims: claims,
      })

      // Supply rows are created in plan order, so they can be zipped back into
      // the plan to give the row list its final order.
      const created = await materialiseSupply(data, plan)
      const queue = [...created]
      const ordered = plan.items.map((item) =>
        item.kind === 'existing' ? item.video.id : (queue.shift()?.id ?? ''),
      )

      await reload()
      start({
        type: 'film',
        windowMinutes,
        videoIds: ordered.filter((id) => id !== ''),
      })
      setStage({ kind: 'chooser' })
      setPlanning(false)
    },
    [claims, data, estimates, reload, start, switchMinutes, tiers, videos],
  )

  const recordWarmup = useCallback(
    async (accountId: string) => {
      await data.recordWarmupEvent(accountId, WARMUP_DEFAULT_MINUTES)
      await reload()
    },
    [data, reload],
  )

  const markOneEdited = useCallback(async () => {
    setEditBusy(true)
    try {
      const filmed = videos
        .filter((v) => v.phase === 'filmed')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      const next = filmed[0]
      if (!next) return
      await data.advanceVideoPhase(next.id, { session: 'edit' })
      await reload()
    } finally {
      setEditBusy(false)
    }
  }, [data, reload, videos])

  const handleTap = useCallback(
    async (video: Video, done: boolean) => {
      setBusyId(video.id)
      try {
        // Local-first: this returns as soon as the write has landed on the
        // device. Nothing here waits on a network round trip.
        if (done) await data.undoLastPhaseMove(video.id, { session: session ?? undefined })
        else await data.advanceVideoPhase(video.id, { session: session ?? undefined })
        await reload()
      } finally {
        setBusyId(null)
      }
    },
    [data, reload, session],
  )

  if (!loaded) return null

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <Header summary={summary} />

      {active !== null ? (
        <SessionList
          session={active.type}
          minutes={active.windowMinutes}
          rowIds={active.videoIds}
          videosById={videosById}
          campaignsById={campaignsById}
          estimates={estimates}
          busyId={busyId}
          onTap={handleTap}
          onStartAt={goTo}
          onChangeSession={() => {
            stop()
            setStage({ kind: 'chooser' })
          }}
        />
      ) : stage.kind === 'chooser' ? (
        <>
          <EditBacklog count={summary.editBacklog} busy={editBusy} onMarkEdited={markOneEdited} />
          <Chooser
            onFilm={() => setStage({ kind: 'pick_campaign' })}
            onWarmUp={() => setStage({ kind: 'warmup_pick' })}
          />
        </>
      ) : stage.kind === 'pick_campaign' ? (
        <CampaignPicker
          campaigns={readyCampaigns}
          onPick={(campaign) => setStage({ kind: 'briefing', campaign })}
          onBack={() => setStage({ kind: 'chooser' })}
        />
      ) : stage.kind === 'briefing' ? (
        <Briefing
          key={stage.campaign.id}
          campaign={stage.campaign}
          onStart={(goal) => void beginConsole(stage.campaign, goal)}
          onAutoPlan={(minutes) => void runAutoPlan(minutes, stage.campaign)}
          onBack={() => setStage({ kind: 'pick_campaign' })}
          planning={planning}
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
            setStage({ kind: 'chooser' })
          }}
        />
      ) : stage.kind === 'warmup_pick' ? (
        <WarmupPicker
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
          onBack={() => setStage({ kind: 'chooser' })}
        />
      ) : (
        <WarmupTimer
          key={stage.account.id}
          account={stage.account}
          campaign={stage.campaign}
          onDone={async () => {
            await recordWarmup(stage.account.id)
            setStage({ kind: 'warmup_pick' })
          }}
          onBack={() => setStage({ kind: 'warmup_pick' })}
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

  return (
    <header className="flex flex-col gap-1">
      <p className="text-5xl font-semibold tabular-nums text-text">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="text-state-later">
        {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
        {' - '}
        <span className="text-text">
          {summary.posted} of {summary.owed} posted
        </span>
      </p>
      <p className="text-sm text-state-later">
        {summary.runwayDays === null
          ? 'No daily quota set'
          : `${summary.runwayDays} days of posts banked`}
      </p>
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-4 py-3">
      <p className="text-text">
        {count} filmed, ready to edit
      </p>
      <button
        type="button"
        onClick={onMarkEdited}
        disabled={busy}
        className="min-h-tap rounded-lg border border-edge bg-surface-raised px-4 font-semibold text-text active:bg-surface disabled:text-state-later"
      >
        {busy ? '...' : 'Mark edited'}
      </button>
    </div>
  )
}

function Chooser({ onFilm, onWarmUp }: { onFilm: () => void; onWarmUp: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onFilm}
          className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold tracking-wide text-text active:bg-surface-raised"
        >
          FILM
        </button>
        <button
          type="button"
          onClick={onWarmUp}
          className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold tracking-wide text-text active:bg-surface-raised"
        >
          WARM-UP
        </button>
      </div>

      <Link
        to="/tick-off"
        className="flex min-h-tap items-center justify-center rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
      >
        Already posted some? Tick them off
      </Link>
    </div>
  )
}

function SessionList({
  session,
  minutes,
  rowIds,
  videosById,
  campaignsById,
  estimates,
  busyId,
  onTap,
  onStartAt,
  onChangeSession,
}: {
  session: SessionType
  minutes: number
  rowIds: readonly string[]
  videosById: Map<string, Video>
  campaignsById: Map<string, Campaign>
  estimates: readonly TimeEstimate[]
  busyId: string | null
  onTap: (video: Video, done: boolean) => void
  onStartAt: (index: number) => void
  onChangeSession: () => void
}) {
  const stagePhase = SESSION_PHASE[session]
  const rows = rowIds.map((id) => videosById.get(id)).filter((v): v is Video => v !== undefined)

  // A row is done once it has left the stage this session works on.
  const isDone = (video: Video) => video.phase !== stagePhase
  const doneCount = rows.filter(isDone).length
  const remaining = rows.filter((v) => !isDone(v))
  const next = remaining[0]

  const minutesLeft = remaining.reduce((sum, video) => {
    const campaign = campaignsById.get(video.campaign_id)
    return sum + (stageMinutes(session, video, estimates, campaign?.default_setup ?? null) ?? 0)
  }, 0)

  // The value of what is left tonight. Deliberately not any of the money
  // figures on the Money screen - it is prospective, not earned - so it is
  // labelled as tonight's work and never summed with them.
  const centsLeft = remaining.reduce((sum, video) => {
    const campaign = campaignsById.get(video.campaign_id)
    return sum + (campaign?.pay_per_video_cents ?? 0)
  }, 0)

  const percent = rows.length === 0 ? 0 : Math.round((doneCount / rows.length) * 100)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-lg font-semibold tabular-nums text-text">
          {doneCount} of {rows.length}
        </p>
        <p className="text-sm tabular-nums text-state-later">
          ~{formatCents(centsLeft)} if you finish tonight - ~{formatMinutes(minutesLeft)} of{' '}
          {minutes}m
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={rows.length}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-state-posted" style={{ width: `${percent}%` }} />
      </div>

      {rows.length === 0 ? (
        <p className="text-state-later">
          Nothing at this stage right now. Try another session type.
        </p>
      ) : (
        <ul aria-label="Tonight" className="flex flex-col gap-3">
          {rows.map((video) => {
            const campaign = campaignsById.get(video.campaign_id)
            const done = isDone(video)
            return (
              <li key={video.id}>
                <VideoRow
                  video={video}
                  campaignName={campaign?.name ?? 'unknown campaign'}
                  done={done}
                  isNext={next?.id === video.id}
                  statusLabel={done ? statusFor(video) : nextActionFor(session, next?.id === video.id)}
                  rateCents={campaign?.pay_per_video_cents ?? null}
                  busy={busyId === video.id}
                  onTap={() => onTap(video, done)}
                />
              </li>
            )
          })}
        </ul>
      )}

      {next ? (
        <Link
          to="/shoot"
          onClick={() => onStartAt(rowIds.indexOf(next.id))}
          className="flex min-h-tap items-center justify-center rounded-lg border border-state-now bg-surface-raised px-4 text-lg font-semibold tracking-wide text-state-now active:bg-surface"
        >
          START - {campaignsById.get(next.campaign_id)?.name ?? 'unknown campaign'}
        </Link>
      ) : rows.length > 0 ? (
        <p className="text-center text-sm text-state-posted">Everything at this stage is done.</p>
      ) : null}

      <button
        type="button"
        onClick={onChangeSession}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Change session
      </button>
    </div>
  )
}

/** FILM: which campaign, before anything is packed. Only campaigns whose
 *  account is not still warming up are offered - see needsWarmup. */
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
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
        Which campaign?
      </h2>

      {campaigns.length === 0 ? (
        <p className="text-state-later">
          Nothing ready to work yet - every campaign is still warming up.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <button
                type="button"
                onClick={() => onPick(campaign)}
                className="flex min-h-tap w-full items-center justify-between rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
              >
                <span>{campaign.name}</span>
                <span className="text-sm tabular-nums text-state-later">
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
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Change session
      </button>
    </div>
  )
}

/** Everything to do and not do for this campaign, fast - read once, right
 *  before the camera comes out, rather than folded away like the brief
 *  page's version of the same list. */
function Briefing({
  campaign,
  onStart,
  onAutoPlan,
  onBack,
  planning,
}: {
  campaign: Campaign
  onStart: (goal: number) => void
  onAutoPlan: (minutes: number) => void
  onBack: () => void
  planning: boolean
}) {
  const data = useData()
  const [rules, setRules] = useState<CampaignRule[] | null>(null)
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [typedGoal, setTypedGoal] = useState('')
  const [autoPlanMinutes, setAutoPlanMinutes] = useState('60')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const nextRules = await data.listCampaignRules(campaign.id)
      if (cancelled) return
      setRules(nextRules)
    })()
    return () => {
      cancelled = true
    }
  }, [campaign.id, data])

  if (rules === null) return null

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>

      {rules.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-state-blocked">
            Never do
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="border-l-2 border-state-blocked/50 pl-3 text-sm text-text"
              >
                {rule.body}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-state-later">No rules saved for this campaign yet.</p>
      )}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          How many to film?
        </h3>
        <div className="mt-2 grid grid-cols-4 gap-3">
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
          className="mt-3 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 text-text placeholder:text-state-later"
        />
      </div>

      <button
        type="button"
        onClick={() => onStart(typedGoal.trim() === '' ? goal : Number(typedGoal))}
        disabled={planning || (typedGoal.trim() !== '' && Number(typedGoal) <= 0)}
        className="min-h-tap rounded-lg border border-state-now bg-surface-raised px-4 text-lg font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        Start filming
      </button>

      {/* The old behaviour, kept as the option he asked for it to be. It is
          the one control left that asks for a number of minutes, since the
          fitting algorithm has to know how much time it is packing. */}
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={autoPlanMinutes}
          onChange={(event) => setAutoPlanMinutes(event.target.value)}
          aria-label="Minutes to plan for"
          className="min-h-tap w-24 rounded-lg border border-edge bg-surface px-3 text-text"
        />
        <button
          type="button"
          onClick={() => onAutoPlan(Number(autoPlanMinutes))}
          disabled={planning || Number(autoPlanMinutes) <= 0}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised disabled:opacity-60"
        >
          Or plan it for me
        </button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Pick a different campaign
      </button>
    </div>
  )
}

/** WARM-UP: which account needs it. Only campaigns whose account has not yet
 *  cleared two warm-up sessions are offered - once a campaign leaves this
 *  list it is ready, and FILM picks it up from there. */
function WarmupPicker({
  accounts,
  campaigns,
  warmupEvents,
  onPick,
  onBack,
}: {
  accounts: CampaignAccount[]
  campaigns: Campaign[]
  warmupEvents: WarmupEvent[]
  onPick: (account: CampaignAccount) => void
  onBack: () => void
}) {
  const nameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
        Which account needs warming up?
      </h2>

      {accounts.length === 0 ? (
        <p className="text-state-later">
          Nothing needs warming up. Every account is ready to post.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => {
            const done = warmupCompletions(account.id, warmupEvents)
            return (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => onPick(account)}
                  className="flex min-h-tap w-full items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-4 text-left font-semibold text-text active:bg-surface-raised"
                >
                  <span>
                    {account.platform}
                    <span className="ml-2 text-sm font-normal text-state-later">
                      {account.handle ?? 'no handle saved'} - {nameById.get(account.campaign_id) ?? 'unknown campaign'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-state-waiting">
                    {done} of {WARMUP_SESSIONS_REQUIRED} done
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Change session
      </button>
    </div>
  )
}

/** The account to warm up, and a countdown. Nothing here touches the video
 *  pipeline - warming up is using the account itself, not filming anything -
 *  so there is no script and nothing to skip. */
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
  const [secondsLeft, setSecondsLeft] = useState(WARMUP_DEFAULT_MINUTES * 60)
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
    <div className="flex flex-col gap-5">
      {/* Which account, and on which platform - the one thing he has to get
          right before touching his phone. */}
      <h2 className="text-lg font-semibold text-text">
        {account.platform}
        <span className="ml-2 text-state-later">{account.handle ?? 'no handle saved'}</span>
      </h2>
      <p className="-mt-3 text-sm text-state-later">{campaign?.name ?? 'unknown campaign'}</p>

      <p className="text-center text-6xl font-semibold tabular-nums text-text" aria-live="polite">
        {mm}:{ss}
      </p>
      <p className="text-center text-sm text-state-later">
        {secondsLeft === 0 ? "Time's up." : 'Use the account normally until this runs out.'}
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
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Pick a different account
      </button>
    </div>
  )
}

function statusFor(video: Video): string {
  switch (video.phase) {
    case 'posted':
      return 'posted'
    case 'approved':
      return 'approved - ready to post'
    case 'submitted':
      return 'waiting on their approval'
    case 'edited':
      return 'edited'
    case 'filmed':
      return 'filmed'
    default:
      return video.phase.replace(/_/g, ' ')
  }
}

function nextActionFor(session: SessionType, isNext: boolean): string {
  if (isNext) return 'do this one'
  switch (session) {
    case 'edit':
      return 'to edit'
    case 'post':
      return 'to post'
    default:
      return 'to film'
  }
}
