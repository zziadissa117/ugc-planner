import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { VideoRow } from '../components/VideoRow'
import type { BonusClaim, BonusTier, Campaign, SessionType, TimeEstimate, Video } from '../data'
import { localToday } from '../data'
import { ensureTodaysQuota, shouldNudgeToEdit, summariseToday } from '../data/today'
import { useData } from '../data/useData'
import { approvedAtFromEvents, fitSession } from '../fitting/fit'
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

  const reload = useCallback(async () => {
    const [nextCampaigns, nextVideos, nextEstimates, settings, nextClaims] = await Promise.all([
      data.listCampaigns(),
      data.listVideos(),
      data.listTimeEstimates(),
      data.getUserSettings(),
      data.listBonusClaims(),
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

  /** Runs the fitting algorithm for the chosen session and window, creates any
   *  supply it decided to make, and freezes the resulting order.
   *
   *  He never picks a count: the plan fills the window, and what comes back is
   *  simply the evening's list, in the order to work it. */
  const startSession = useCallback(
    async (type: SessionType, windowMinutes: number) => {
      setPlanning(true)
      const events = await data.listPhaseEvents()
      const plan = fitSession({
        session: type,
        windowMinutes,
        videos,
        campaigns,
        estimates,
        setupSwitchMinutes: switchMinutes,
        today: localToday(),
        approvedAt: approvedAtFromEvents(events),
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
      setPlanning(false)
    },
    [campaigns, claims, data, estimates, reload, start, switchMinutes, tiers, videos],
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

      {active === null ? (
        <Chooser
          freeMinutes={freeMinutes}
          setFreeMinutes={setFreeMinutes}
          onStart={(type, windowMinutes) => void startSession(type, windowMinutes)}
          nudgeToEdit={shouldNudgeToEdit(summary)}
          planning={planning}
        />
      ) : (
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
          onChangeSession={stop}
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
