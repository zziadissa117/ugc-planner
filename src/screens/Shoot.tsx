import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { buildChatGptBlock } from '../chatgpt'
import type { Campaign, CampaignField, CampaignRule, Video } from '../data'
import { useData } from '../data/useData'
import { SESSION_VERB, formatCents } from '../session'
import { useSession } from '../session/useSession'

/** SPEC section 5. One video at a time, stripped to almost nothing.
 *
 *  What is deliberately absent: phase diagrams, difficulty ratings, take
 *  counters, statistics. He is holding a camera. The script is the most
 *  readable thing on the screen because he reads it off a phone propped next
 *  to one. */
export function Shoot() {
  const data = useData()
  const navigate = useNavigate()
  const { active, skip, stop } = useSession()

  const [video, setVideo] = useState<Video | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [fields, setFields] = useState<CampaignField[]>([])
  const [rules, setRules] = useState<CampaignRule[]>([])

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const videoId = active ? active.videoIds[active.index] : undefined

  useEffect(() => {
    if (!videoId) return
    let cancelled = false

    void (async () => {
      const nextVideo = await data.getVideo(videoId)
      if (cancelled || !nextVideo) return
      const [nextCampaign, nextFields, nextRules] = await Promise.all([
        data.getCampaign(nextVideo.campaign_id),
        data.listCampaignFields(nextVideo.campaign_id),
        data.listCampaignRules(nextVideo.campaign_id),
      ])
      if (cancelled) return

      setVideo(nextVideo)
      setCampaign(nextCampaign)
      setFields(nextFields)
      setRules(nextRules)
      setDraft(nextVideo.script ?? '')
      // A video with no script yet opens straight into the paste box; one that
      // has a script opens as the teleprompter.
      setEditing(nextVideo.script === null || nextVideo.script === '')
      setCopied(null)
    })()

    return () => {
      cancelled = true
    }
  }, [data, videoId])

  const saveScript = useCallback(async () => {
    if (!video) return
    setBusy(true)
    try {
      const saved = await data.updateVideo(video.id, { script: draft.trim() === '' ? null : draft })
      setVideo(saved)
      setEditing(saved.script === null)
    } finally {
      setBusy(false)
    }
  }, [data, draft, video])

  const handlePrimary = useCallback(async () => {
    if (!video || !active) return
    setBusy(true)
    try {
      await data.advanceVideoPhase(video.id, { session: active.type })
      // Straight on to the next one. He is mid-session with a camera set up;
      // the last thing he needs is a screen asking what to do next.
      skip()
    } finally {
      setBusy(false)
    }
  }, [active, data, skip, video])

  const copyForChatGpt = useCallback(async () => {
    if (!campaign) return
    const block = buildChatGptBlock(campaign, fields, rules)
    try {
      await navigator.clipboard.writeText(block)
      setCopied('Copied.')
    } catch {
      setCopied('Could not copy - it is shown below, select and copy it.')
    }
  }, [campaign, fields, rules])

  const handleStop = useCallback(() => {
    stop()
    void navigate('/')
  }, [navigate, stop])

  if (!active) {
    return (
      <section className="mx-auto flex max-w-screen-sm flex-col gap-4">
        <p className="text-state-later">No session running.</p>
        <Link
          to="/"
          className="flex min-h-tap items-center justify-center rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
        >
          Back to NOW
        </Link>
      </section>
    )
  }

  if (!video || !campaign) return null

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-5">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="truncate text-lg font-semibold uppercase tracking-wide text-text">
          {campaign.name}
        </h1>
        <span className="shrink-0 tabular-nums text-state-later">
          {campaign.pay_per_video_cents === null ? (
            <span className="text-sm text-state-waiting">no rate yet</span>
          ) : (
            formatCents(campaign.pay_per_video_cents)
          )}
        </span>
      </header>

      <ProgressDots total={active.videoIds.length} index={active.index} />

      {editing ? (
        <div className="flex flex-col gap-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Script"
            placeholder="Paste the script here."
            className="h-56 w-full resize-y rounded-lg border border-edge bg-surface p-4 text-lg leading-relaxed text-text placeholder:text-state-later"
          />
          <button
            type="button"
            onClick={() => void saveScript()}
            disabled={busy}
            className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
          >
            Save script
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Teleprompter. The most readable text on the screen, because it is
              read off a propped-up phone from arm's length. */}
          <p className="whitespace-pre-wrap text-2xl leading-relaxed tracking-tight text-text">
            {video.script}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-tap self-start rounded-lg px-2 text-sm font-semibold text-state-later active:bg-surface-raised"
          >
            Edit script
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handlePrimary()}
        disabled={busy}
        className="min-h-tap w-full rounded-lg border border-state-now bg-surface-raised px-4 text-lg font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        {SESSION_VERB[active.type]}
      </button>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/campaigns/${campaign.id}`}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-3 text-center text-sm font-semibold leading-[3.5rem] text-state-later active:bg-surface-raised"
        >
          read brief
        </Link>
        <button
          type="button"
          onClick={() => void copyForChatGpt()}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
        >
          copy for chatgpt
        </button>
        <button
          type="button"
          onClick={skip}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
        >
          skip
        </button>
        <button
          type="button"
          onClick={handleStop}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
        >
          stop
        </button>
      </div>

      {copied ? <p className="text-sm text-state-later">{copied}</p> : null}
    </section>
  )
}

/** Where he is in tonight's list. Dots, not a phase diagram - this says how
 *  many are left, which is the only progress question worth answering with a
 *  camera in hand. */
function ProgressDots({ total, index }: { total: number; index: number }) {
  return (
    <p
      aria-label={`Video ${index + 1} of ${total}`}
      className="flex gap-2 text-lg leading-none text-state-later"
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} aria-hidden className={i === index ? 'text-state-now' : undefined}>
          {i === index ? 'o' : '-'}
        </span>
      ))}
    </p>
  )
}
