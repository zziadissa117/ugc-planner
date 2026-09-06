import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { VideoRow } from '../components/VideoRow'
import type {
  BonusClaim,
  BonusTier,
  Campaign,
  CampaignField,
  CampaignRule,
  SessionType,
  TimeEstimate,
  Video,
  WarmupEvent,
} from '../data'
import { WARMUP_SESSIONS_REQUIRED, localToday, needsWarmup, warmupCompletions } from '../data'
import { ensureTodaysQuota, shouldNudgeToEdit, summariseToday } from '../data/today'
import { useData } from '../data/useData'
import { readyAtFromEvents, fitSession } from '../fitting/fit'
import { materialiseSupply } from '../fitting/supply'
import {
  SESSION_MINUTES,
  SESSION_PHASE,
  SESSION_TYPES,
  formatCents,
  formatMinutes,
  stageMinutes,
} from '../session'
import { useSession } from '../session/useSession'

/** FILM and EDIT are worked one campaign at a time now: he picks which
 *  campaign before anything is packed, sees its do/don't list at a glance,
 *  and only that campaign's work fills the window. WARM-UP never touches the
 *  video pipeline at all - it is a timer against an account, not a session
 *  full of videos - so it gets its own stages entirely. */
type Stage =
  | { kind: 'chooser' }
  | { kind: 'pick_campaign'; type: 'film' | 'edit'; minutes: number }
  | { kind: 'briefing'; type: 'film' | 'edit'; minutes: number; campaign: Campaign }
  | { kind: 'warmup_pick'; minutes: number }
  | { kind: 'warmup_timer'; minutes: number; campaign: Campaign }

const START_LABEL: Record<'film' | 'edit', string> = {
  film: 'Start filming',
  edit: 'Start editing',
}

export function Now() {
  const data = useData()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [estimates, setEstimates] = useState<TimeEstimate[]>([])
  const [loaded, setLoaded] = useState(false)

  const [freeMinutes, setFreeMinutes] = useState('')
  const [planning, setPlanning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  /** The evening in progress lives in the session context so SHOOT is walking
   *  the same list, in the same frozen order, that NOW is showing. */
  const { active, start, goTo, stop } = useSession()
  const session = active?.type ?? null

  const [switchMinutes, setSwitchMinutes] = useState(10)
  const [tiers, setTiers] = useState<BonusTier[]>([])
  const [claims, setClaims] = useState<BonusClaim[]>([])
  const [warmupEvents, setWarmupEvents] = useState<WarmupEvent[]>([])
  const [stage, setStage] = useState<Stage>({ kind: 'chooser' })

  const reload = useCallback(async () => {
    const [nextCampaigns, nextVideos, nextEstimates, settings, nextClaims, nextWarmupEvents] =
      await Promise.all([
        data.listCampaigns(),
        data.listVideos(),
        data.listTimeEstimates(),
        data.getUserSettings(),
        data.listBonusClaims(),
        data.listWarmupEvents(),
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
    return { nextCampaigns, nextVideos, nextEstimates, settings, nextTiers, nextClaims }
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

  // A campaign that has never actually posted - not even a carried-over
  // opening count - has no live account yet, so FILM and EDIT never offer it
  // and WARM-UP is the only thing that can move it forward.
  const readyCampaigns = useMemo(
    () => campaigns.filter((c) => !needsWarmup(c, videos, warmupEvents)),
    [campaigns, videos, warmupEvents],
  )
  const warmupCampaigns = useMemo(
    () => campaigns.filter((c) => needsWarmup(c, videos, warmupEvents)),
    [campaigns, videos, warmupEvents],
  )

  /** Runs the fitting algorithm for the chosen session and window, creates any
   *  supply it decided to make, and freezes the resulting order.
   *
   *  He never picks a count: the plan fills the window, and what comes back is
   *  simply the evening's list, in the order to work it.
   *
   *  `onlyCampaign` is how FILM and EDIT became single-campaign: fitSession
   *  scores and builds supply purely from the campaigns it is handed, so
   *  handing it exactly one is the entire restriction - nothing in the
   *  algorithm itself changes. */
  const startSession = useCallback(
    async (type: SessionType, windowMinutes: number, onlyCampaign?: Campaign) => {
      setPlanning(true)
      const events = await data.listPhaseEvents()
      const plan = fitSession({
        session: type,
        windowMinutes,
        videos,
        campaigns: onlyCampaign ? [onlyCampaign] : campaigns,
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
        type,
        windowMinutes,
        videoIds: ordered.filter((id) => id !== ''),
      })
      setStage({ kind: 'chooser' })
      setPlanning(false)
    },
    [campaigns, claims, data, estimates, reload, start, switchMinutes, tiers, videos],
  )

  const pickSessionKind = useCallback(
    (type: SessionType, minutes: number) => {
      if (type === 'post') {
        void startSession('post', minutes)
        return
      }
      if (type === 'warm_up') {
        setStage({ kind: 'warmup_pick', minutes })
        return
      }
      setStage({ kind: 'pick_campaign', type, minutes })
    },
    [startSession],
  )

  const recordWarmup = useCallback(
    async (campaignId: string, minutes: number) => {
      await data.recordWarmupEvent(campaignId, minutes)
      await reload()
    },
    [data, reload],
  )

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
        <Chooser
          freeMinutes={freeMinutes}
          setFreeMinutes={setFreeMinutes}
          onStart={pickSessionKind}
          nudgeToEdit={shouldNudgeToEdit(summary)}
          planning={planning}
        />
      ) : stage.kind === 'pick_campaign' ? (
        <CampaignPicker
          campaigns={readyCampaigns}
          onPick={(campaign) =>
            setStage({ kind: 'briefing', type: stage.type, minutes: stage.minutes, campaign })
          }
          onBack={() => setStage({ kind: 'chooser' })}
        />
      ) : stage.kind === 'briefing' ? (
        <Briefing
          key={stage.campaign.id}
          campaign={stage.campaign}
          sessionType={stage.type}
          onStart={() => void startSession(stage.type, stage.minutes, stage.campaign)}
          onBack={() => setStage({ kind: 'pick_campaign', type: stage.type, minutes: stage.minutes })}
          planning={planning}
        />
      ) : stage.kind === 'warmup_pick' ? (
        <WarmupPicker
          campaigns={warmupCampaigns}
          warmupEvents={warmupEvents}
          onPick={(campaign) => setStage({ kind: 'warmup_timer', minutes: stage.minutes, campaign })}
          onBack={() => setStage({ kind: 'chooser' })}
        />
      ) : (
        <WarmupTimer
          key={stage.campaign.id}
          campaign={stage.campaign}
          minutes={stage.minutes}
          onDone={async () => {
            await recordWarmup(stage.campaign.id, stage.minutes)
            setStage({ kind: 'warmup_pick', minutes: stage.minutes })
          }}
          onBack={() => setStage({ kind: 'warmup_pick', minutes: stage.minutes })}
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

function Chooser({
  freeMinutes,
  setFreeMinutes,
  onStart,
  nudgeToEdit,
  planning,
}: {
  freeMinutes: string
  setFreeMinutes: (value: string) => void
  onStart: (session: SessionType, minutes: number) => void
  nudgeToEdit: boolean
  planning: boolean
}) {
  const [pending, setPending] = useState<SessionType | null>(null)

  return (
    <div className="flex flex-col gap-6">
      {/* One line of text, never a modal. */}
      {nudgeToEdit ? (
        <p className="text-sm text-state-waiting">
          Under 3 days banked and there is a filmed backlog - an EDIT session buys the most runway.
        </p>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          What kind of session?
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {SESSION_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setPending(type.value)}
              aria-pressed={pending === type.value}
              className={[
                'min-h-tap rounded-lg border px-4 font-semibold tracking-wide active:bg-surface-raised',
                pending === type.value
                  ? 'border-state-now bg-surface-raised text-state-now'
                  : 'border-edge bg-surface text-state-later',
              ].join(' ')}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          How long tonight?
        </h2>
        <div className="mt-2 grid grid-cols-4 gap-3">
          {SESSION_MINUTES.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={pending === null || planning}
              onClick={() => pending && onStart(pending, preset)}
              className="min-h-tap rounded-lg border border-edge bg-surface font-semibold text-text active:bg-surface-raised disabled:text-state-later"
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-3">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={freeMinutes}
            onChange={(event) => setFreeMinutes(event.target.value)}
            placeholder="or type minutes"
            className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 text-text placeholder:text-state-later"
          />
          <button
            type="button"
            disabled={pending === null || planning || Number(freeMinutes) <= 0}
            onClick={() => pending && onStart(pending, Number(freeMinutes))}
            className="min-h-tap rounded-lg border border-edge bg-surface px-5 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
          >
            Go
          </button>
        </div>
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

  // The value of what is left tonight. Deliberately not any of the three money
  // figures - it is prospective, not earned - so it is labelled as tonight's
  // work and never summed with them.
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
        {/* Prospective, not earned. Worded so it cannot be read as a ledger
            figure: it is what tonight is worth if he finishes it, and it is
            never summed with base earned, expected bonus or paid bonus. */}
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

/** FILM and EDIT: which campaign, before anything is packed. Only campaigns
 *  whose account is not still warming up are offered - see needsWarmup. */
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
 *  page's version of the same list. EDIT additionally shows the editing
 *  style he typed himself, since no document ever states one. */
function Briefing({
  campaign,
  sessionType,
  onStart,
  onBack,
  planning,
}: {
  campaign: Campaign
  sessionType: 'film' | 'edit'
  onStart: () => void
  onBack: () => void
  planning: boolean
}) {
  const data = useData()
  const [rules, setRules] = useState<CampaignRule[] | null>(null)
  const [editingStyle, setEditingStyle] = useState<CampaignField | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextRules, fields] = await Promise.all([
        data.listCampaignRules(campaign.id),
        data.listCampaignFields(campaign.id),
      ])
      if (cancelled) return
      setRules(nextRules)
      setEditingStyle(fields.find((f) => f.field_key === 'editing_style') ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [campaign.id, data])

  if (rules === null) return null

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>

      {sessionType === 'edit' ? (
        <div className="rounded-lg border border-edge bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-state-later">
            Editing style
          </p>
          <p className="mt-1 text-text">
            {editingStyle?.field_value ??
              'not saved yet - no document states one, add it on the brief page'}
          </p>
        </div>
      ) : null}

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

      <button
        type="button"
        onClick={onStart}
        disabled={planning}
        className="min-h-tap rounded-lg border border-state-now bg-surface-raised px-4 text-lg font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        {START_LABEL[sessionType]}
      </button>

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
 *  list it is ready, and FILM/EDIT pick it up from there. */
function WarmupPicker({
  campaigns,
  warmupEvents,
  onPick,
  onBack,
}: {
  campaigns: Campaign[]
  warmupEvents: WarmupEvent[]
  onPick: (campaign: Campaign) => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
        Which account needs warming up?
      </h2>

      {campaigns.length === 0 ? (
        <p className="text-state-later">
          Nothing needs warming up. Every account is ready to post.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => {
            const done = warmupCompletions(campaign.id, warmupEvents)
            return (
              <li key={campaign.id}>
                <button
                  type="button"
                  onClick={() => onPick(campaign)}
                  className="flex min-h-tap w-full items-center justify-between rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
                >
                  <span>{campaign.name}</span>
                  <span className="text-sm tabular-nums text-state-waiting">
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

/** The account to warm up, and a countdown for the window he chose. Nothing
 *  here touches the video pipeline - warming up is using the account itself,
 *  not filming anything - so there is no script and nothing to skip. */
function WarmupTimer({
  campaign,
  minutes,
  onDone,
  onBack,
}: {
  campaign: Campaign
  minutes: number
  onDone: () => Promise<void>
  onBack: () => void
}) {
  const data = useData()
  const [fields, setFields] = useState<CampaignField[] | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(minutes * 60)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void data.listCampaignFields(campaign.id).then((next) => {
      if (!cancelled) setFields(next)
    })
    return () => {
      cancelled = true
    }
  }, [campaign.id, data])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const byKey = new Map((fields ?? []).map((f) => [f.field_key, f]))
  const platforms = byKey.get('platforms')?.field_value
  const handleTiktok = byKey.get('handle_tiktok')?.field_value
  const handleInstagram = byKey.get('handle_instagram')?.field_value

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
      <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-edge bg-surface-raised px-3 py-1.5 text-sm text-text">
          {platforms ?? 'platform not saved yet'}
        </span>
        {handleTiktok ? (
          <span className="rounded-full border border-edge bg-surface-raised px-3 py-1.5 text-sm text-text">
            TikTok {handleTiktok}
          </span>
        ) : null}
        {handleInstagram ? (
          <span className="rounded-full border border-edge bg-surface-raised px-3 py-1.5 text-sm text-text">
            Instagram {handleInstagram}
          </span>
        ) : null}
      </div>

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
