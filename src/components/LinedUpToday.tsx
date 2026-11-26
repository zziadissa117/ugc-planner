// Beside a campaign's name on POST: what the cutter (or Postiz) has going
// out for it today, and when - "1 posted · 9:04 am", "1 scheduled ·
// 6:00 pm" - so he can see what is out and what is not without leaving the
// screen. He asked for it: "how many posts are scheduled for today... and
// the hour when it's going to be posted."
//
// Read only. It sits beside the name and never on a box: ticking stays his
// tap (CLAUDE.md, "He ticks every Post box himself").

import { lineUp, type GoingOutVideo, type VideoStatus } from '../data/goingOut'
import { clock } from '../data/weeklyPlan'
import type { Tone } from './styles'
import { StateDot } from './ui'

const WORD: Record<VideoStatus, string> = {
  posted: 'posted',
  scheduled: 'scheduled',
  waiting: 'to approve',
  failed: 'failed',
}

/** Out is green, scheduled grey (later), waiting for his approval white (do
 *  this now), failed red - as in Going out. */
const TONE: Record<VideoStatus, Tone> = {
  posted: 'posted',
  scheduled: 'later',
  waiting: 'now',
  failed: 'blocked',
}

/** Past this many times the rest read "+N", so a campaign owing twenty-five
 *  a day does not push its boxes down the screen - two on a phone, where
 *  the name beside it needs the room, four on anything wider. */
const MOST_TIMES = 4
const MOST_TIMES_PHONE = 2

function at(iso: string): string {
  const time = new Date(iso)
  return clock(time.getHours() * 60 + time.getMinutes())
}

/** One line per status: a dot, how many, and their times. */
export function LinedUpToday({ videos, complete, className = '' }: { videos: readonly GoingOutVideo[]; complete: boolean; className?: string }) {
  const parts = lineUp(videos)
  if (parts.length === 0) {
    return complete ? <p className={`meta text-state-later ${className}`}>Nothing scheduled</p> : null
  }
  return (
    <ul aria-label="Going out today" className={`flex flex-col gap-1 ${className}`}>
      {parts.map((part) => {
        const shown = part.times.slice(0, MOST_TIMES).map(at)
        const morePhone = part.times.length - Math.min(part.times.length, MOST_TIMES_PHONE)
        const more = part.times.length - shown.length
        return (
          <li key={part.status} className="flex flex-col items-end gap-0.5 text-right">
            <span className="flex items-center gap-1.5">
              <StateDot tone={TONE[part.status]} />
              <span className={`numeric meta font-semibold ${part.status === 'failed' ? 'text-state-blocked' : 'text-text'}`}>
                {part.count} {WORD[part.status]}
              </span>
            </span>
            <span className="numeric meta text-text-dim">
              {shown.map((time, i) => (
                <span key={i} className={i >= MOST_TIMES_PHONE ? 'hidden sm:inline' : undefined}>
                  {i > 0 ? <span aria-hidden> · </span> : null}
                  <span className="whitespace-nowrap">{time}</span>
                </span>
              ))}
              {morePhone > 0 ? <span className="whitespace-nowrap sm:hidden"> +{morePhone}</span> : null}
              {more > 0 ? <span className="hidden whitespace-nowrap sm:inline"> +{more}</span> : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
