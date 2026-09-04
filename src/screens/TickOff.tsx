import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { VideoRow } from '../components/VideoRow'
import type { Campaign, Video } from '../data'
import { localToday } from '../data'
import { ensureTodaysQuota } from '../data/today'
import { useData } from '../data/useData'

/** SPEC section 6.
 *
 *  Reached from NOW without picking a session type or a window, because this
 *  is the screen for the evening where he already did the work on his phone
 *  and just needs to tell the app. It must not require planning anything
 *  first, so there is nothing on it to choose.
 *
 *  A tap marks the video posted from wherever it is - it does not walk the
 *  approval chain. He is recording something that already happened. */
export function TickOff() {
  const data = useData()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [rowIds, setRowIds] = useState<string[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const today = localToday()

  const reload = useCallback(async () => {
    const [nextCampaigns, nextVideos] = await Promise.all([
      data.listCampaigns(),
      data.listVideos({ owedForDate: today }),
    ])
    setCampaigns(nextCampaigns)
    setVideos(nextVideos)
    return { nextCampaigns, nextVideos }
  }, [data, today])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureTodaysQuota(data)
      if (cancelled) return
      const { nextCampaigns, nextVideos } = await reload()
      if (cancelled) return

      // Sorted alphabetically by campaign, and then frozen. The order is fixed
      // once so that ticking a row off never moves the rows beneath it out
      // from under his thumb.
      const nameById = new Map(nextCampaigns.map((c) => [c.id, c.name]))
      const ordered = [...nextVideos].sort((a, b) => {
        const byName = (nameById.get(a.campaign_id) ?? '').localeCompare(
          nameById.get(b.campaign_id) ?? '',
        )
        return byName !== 0 ? byName : a.id.localeCompare(b.id)
      })
      setRowIds(ordered.map((v) => v.id))
    })()
    return () => {
      cancelled = true
    }
  }, [data, reload])

  const campaignsById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])
  const videosById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos])

  const handleTap = useCallback(
    async (video: Video, done: boolean) => {
      setBusyId(video.id)
      try {
        if (done) await data.undoLastPhaseMove(video.id, { session: 'post' })
        else await data.markVideoPosted(video.id, { session: 'post' })
        await reload()
      } finally {
        setBusyId(null)
      }
    },
    [data, reload],
  )

  if (rowIds === null) return null

  const rows = rowIds.map((id) => videosById.get(id)).filter((v): v is Video => v !== undefined)
  const postedCount = rows.filter((v) => v.phase === 'posted').length

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold text-text">Tick them off</h1>
        <p className="text-state-later">
          {postedCount} of {rows.length} owed today
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-state-later">Nothing owed today.</p>
      ) : (
        <ul aria-label="Owed today" className="flex flex-col gap-3">
          {rows.map((video) => {
            const campaign = campaignsById.get(video.campaign_id)
            const done = video.phase === 'posted'
            return (
              <li key={video.id}>
                <VideoRow
                  video={video}
                  campaignName={campaign?.name ?? 'unknown campaign'}
                  done={done}
                  isNext={false}
                  statusLabel={done ? 'posted' : 'tap when posted'}
                  rateCents={campaign?.pay_per_video_cents ?? null}
                  busy={busyId === video.id}
                  onTap={() => handleTap(video, done)}
                />
              </li>
            )
          })}
        </ul>
      )}

      <Link
        to="/"
        className="flex min-h-tap items-center justify-center rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Back
      </Link>
    </section>
  )
}
