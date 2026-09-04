// What a session is, and what it considers.
//
// An evening is a pass over ONE stage of the pipeline, so a session's list is
// scoped to the phase that stage works on. A FILM session never proposes
// editing and is timed in film minutes only.
//
// The ordering and packing of that list is the fitting algorithm's job in
// phase 5. This file only decides what is eligible and what it costs.

import type { SessionType, SetupType, TimeEstimate, Video, VideoPhase } from './data'

export const SESSION_TYPES: readonly { value: SessionType; label: string }[] = [
  { value: 'film', label: 'FILM' },
  { value: 'edit', label: 'EDIT' },
  { value: 'post', label: 'POST' },
  { value: 'warm_up', label: 'WARM-UP' },
]

/** The preset windows, plus a free-type box in the UI. */
export const SESSION_MINUTES = [30, 60, 90, 120] as const

/** The phase each session type works on. */
export const SESSION_PHASE: Record<SessionType, VideoPhase> = {
  film: 'to_film',
  edit: 'filmed',
  // POST works the approved stock: videos cleared and waiting to go out.
  post: 'approved',
  warm_up: 'to_film',
}

/** The button label on a row and on the SHOOT screen. */
export const SESSION_VERB: Record<SessionType, string> = {
  film: 'FILMED IT',
  edit: 'EDITED IT',
  post: 'POSTED IT',
  warm_up: 'FILMED IT',
}

/** Videos this session should consider.
 *
 *  Scoped to the session's own stage, and split on kind so that warm-up
 *  content - which carries no brand mention and never counts toward a paid
 *  quota - is worked in its own session rather than mixed into a paid one. */
export function eligibleVideos(session: SessionType, videos: readonly Video[]): Video[] {
  const phase = SESSION_PHASE[session]
  return videos.filter((video) => {
    if (video.phase !== phase) return false
    if (session === 'warm_up') return video.kind === 'warm_up'
    if (session === 'film') return video.kind !== 'warm_up'
    return true
  })
}

/** Minutes this session's stage costs for one video, from the EST table.
 *
 *  Timed in the current stage's minutes only - never the whole pipeline - so a
 *  FILM session is costed in film minutes and nothing else. Returns null when
 *  the video has no setup, since guessing one would put an invented number in
 *  front of him.
 *
 *  Setup-switch batching is deliberately not applied here: that is the fitting
 *  algorithm's job in phase 5, and it needs the un-batched per-video cost to
 *  work from. */
export function stageMinutes(
  session: SessionType,
  video: Video,
  estimates: readonly TimeEstimate[],
  campaignDefaultSetup: SetupType | null,
): number | null {
  const setup = video.setup ?? campaignDefaultSetup
  if (setup === null) return null

  const estimate = estimates.find((e) => e.setup === setup)
  if (!estimate) return null

  switch (session) {
    case 'edit':
      return estimate.edit_minutes
    case 'post':
      return estimate.post_minutes
    case 'film':
    case 'warm_up':
      return estimate.film_minutes
  }
}

/** Rounds a minute count into something readable: 72 -> "1h 12m". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Integer cents in, a readable figure out. The division happens at the edge,
 *  for display only - storage is always integer cents. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
