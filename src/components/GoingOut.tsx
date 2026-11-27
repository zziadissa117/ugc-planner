// GOING OUT - what is lined up today, or this week, campaign by campaign: "X
// of Y", where X is the videos out or scheduled and Y what the campaign owes
// (src/data/goingOut.ts). He asked for it this way - "Do it by campaign.
// GoDaddy, you can do 20 out of 20, or Pump Fund, 5 out of 10" - instead of
// one long list of every account's post, so that in the morning, with no idea
// what to do, he can see what is next. A campaign with nothing lined up reads
// "0 of 4": that is the answer.
//
// Laid out as a grid of small tiles, two or three across, not one tall row
// per campaign: with a dozen campaigns the rows ran the whole height of the
// screen, and he asked for it shorter - "too long vertically... it needs to
// be evened out". A tile is the name, "X of Y" and a slim bar; what is out
// and what is scheduled is in the bar and, word for word, in the tile's
// videos.
//
// Tap a campaign to see its videos, one row per video however many accounts
// it went to. They open right under the tile's row, one campaign at a time,
// and no tile moves. Read only. It never ticks a Post box - ticking stays his own tap
// (CLAUDE.md). Read with the Postiz key saved in SETUP (src/sync/postizPosts.ts)
// - for a key the cutter posts with, from the cutter's own records.

import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import {
  breakdown,
  goingOutRows,
  type GoingOutRow,
  type GoingOutSpan,
  type GoingOutVideo,
  type VideoStatus,
} from '../data/goingOut'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { clock } from '../data/weeklyPlan'
import type { PostizPostsAnswer } from '../sync/postizPosts'
import { loadPostizPosts } from '../sync/postizPosts'
import { dayBounds, weekBounds } from '../todaySchedule'
import { PlatformGlyph } from './icons'
import type { Tone } from './styles'
import { Card, SectionLabel, StateDot } from './ui'
import { useConnection } from './useConnection'

const STATUS_WORD: Record<VideoStatus, string> = {
  posted: 'Out',
  scheduled: 'Scheduled',
  waiting: 'To approve',
  failed: 'Failed',
}

/** Out is green, scheduled grey (later), waiting for his approval white (do
 *  this now), failed red. */
const STATUS_TONE: Record<VideoStatus, Tone> = {
  posted: 'posted',
  scheduled: 'later',
  waiting: 'now',
  failed: 'blocked',
}

const STATUS_TEXT: Record<VideoStatus, string> = {
  posted: 'text-state-later',
  scheduled: 'text-state-later',
  waiting: 'text-state-now',
  failed: 'text-state-blocked',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "9:00 pm", or "Tue 9:00 pm" across the week. */
function when(iso: string, span: GoingOutSpan): string {
  const at = new Date(iso)
  const time = clock(at.getHours() * 60 + at.getMinutes())
  return span === 'week' ? `${DAYS[at.getDay()]} ${time}` : time
}

export function GoingOut({ now, load = loadPostizPosts }: { now: Date; load?: typeof loadPostizPosts }) {
  const data = useData()
  const { online, tick } = useConnection()
  const [span, setSpan] = useState<GoingOutSpan>('today')
  // One campaign open at a time, so its videos sit under its own tile.
  const [open, setOpen] = useState<string | null>(null)

  // The range moves with the day, not with every half-minute clock tick.
  const dayKey = now.toDateString()
  const bounds = span === 'today' ? dayBounds(new Date(dayKey)) : weekBounds(new Date(dayKey))
  const from = bounds.from.toISOString()
  const to = bounds.to.toISOString()
  const key = `${span}:${from}`

  // Each answer is kept with the range it answers, so switching ranges reads
  // as loading until the new one lands - no flash of the old numbers.
  const [found, setFound] = useState<{ key: string; answer: PostizPostsAnswer | null } | null>(null)

  const [planner] = useLoaded(async () => {
    const [campaigns, accounts] = await Promise.all([data.listCampaigns(), data.listCampaignAccounts()])
    return { campaigns, accounts }
  }, [data])

  useEffect(() => {
    if (!online) return
    let cancelled = false
    load({ from, to })
      .then((answer) => {
        if (!cancelled) setFound({ key, answer })
      })
      .catch((error: unknown) => {
        if (!cancelled) setFound({ key, answer: { connected: true, posts: [], reading: 0, error: error instanceof Error ? error.message : String(error) } })
      })
    return () => {
      cancelled = true
    }
    // `tick` reads again when the connection comes back.
  }, [from, to, key, load, online, tick])

  const answer: PostizPostsAnswer | null | 'loading' | 'offline' = !online ? 'offline' : found?.key === key ? found.answer : 'loading'

  // Signed out: there is nothing of his to read, and nothing to say about it.
  if (answer === null) return null

  const toggle = (rowKey: string) => setOpen((current) => (current === rowKey ? null : rowKey))

  let body
  if (answer === 'offline') {
    body = <Quiet>Going out needs a connection.</Quiet>
  } else if (answer === 'loading' || !planner) {
    body = <Quiet>Checking what's going out…</Quiet>
  } else if (!answer.connected) {
    body = answer.error ? (
      <Quiet>{answer.error}</Quiet>
    ) : (
      <Quiet>
        <Link to="/settings#postiz" className="font-semibold text-brand hover:text-text">
          Add your Postiz key
        </Link>{' '}
        to see what's going out.
      </Quiet>
    )
  } else if (answer.error && !answer.source) {
    // The read itself failed: nothing was counted, so no campaign is shown as
    // "0 of 4" when it may not be.
    body = <Quiet>{answer.error}</Quiet>
  } else {
    const rows = goingOutRows({ posts: answer.posts, campaigns: planner.campaigns, accounts: planner.accounts, span, ...bounds })
    // From the cutter's records nothing is ever out of Postiz requests.
    const note = answer.source !== 'cutter' && answer.error ? answer.error : null
    body = (
      <>
        {rows.length === 0 ? (
          <Quiet>{span === 'today' ? 'Nothing going out today.' : 'Nothing going out this week.'}</Quiet>
        ) : (
          // Dense, so an open campaign's videos - a full-width item right
          // after its tile - drop under that tile's row while the rest of the
          // row stays where it was.
          <ul className="grid grid-flow-row-dense grid-cols-2 gap-2 sm:grid-cols-3">
            {rows.map((row) => (
              <CampaignTile key={row.key} row={row} span={span} open={open === row.key} onToggle={() => toggle(row.key)} />
            ))}
          </ul>
        )}
        {note ? <p className="meta mt-3 border-t border-rule px-2 pt-3 pb-1 text-text-dim">{note}</p> : null}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Going out">
      <SectionLabel
        trailing={
          <span role="tablist" aria-label="Going out when" className="flex gap-1">
            {(['today', 'week'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={span === value}
                onClick={() => setSpan(value)}
                className={`rounded-full px-2.5 py-1 transition-colors duration-200 ${span === value ? 'bg-brand/15 text-text' : 'text-state-later hover:text-text'}`}
              >
                {value === 'today' ? 'Today' : 'This week'}
              </button>
            ))}
          </span>
        }
      >
        Going out
      </SectionLabel>

      <Card className="p-3">{body}</Card>
    </section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-base text-text-dim">{children}</p>
}

/** One campaign as a small tile: its name, "X of Y" (or "N today" with no
 *  quota) and a slim bar - green out, grey scheduled, the empty track still
 *  owed. A video waiting for his approval, or one that failed, is still to
 *  do, so it is said in words. Tapped, its videos open under the tile's row. */
function CampaignTile({ row, span, open, onToggle }: { row: GoingOutRow; span: GoingOutSpan; open: boolean; onToggle: () => void }) {
  const panel = useId()
  const toDo = [
    row.counts.waiting > 0 ? { word: `${row.counts.waiting} to approve`, text: 'text-state-now' } : null,
    row.counts.failed > 0 ? { word: `${row.counts.failed} failed`, text: 'text-state-blocked' } : null,
  ].filter((part) => part !== null)

  return (
    <Fragment>
      <li className="min-w-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
          title={row.name}
          className={`press flex h-full min-h-tap w-full flex-col gap-2 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
            open ? 'bg-brand/10 ring-1 ring-brand/50' : 'bg-white/[0.03] hover:bg-white/[0.06]'
          }`}
        >
          {/* The name has the tile's whole width - beside the number it was
              cut to "Polymar..." on a phone. */}
          <span className={`truncate text-sm font-semibold ${row.kind === 'none' ? 'text-text-dim' : 'text-text'}`}>{row.name}</span>
          <span className="flex items-center gap-2.5">
            {row.owed !== null ? <Bar row={row} owed={row.owed} /> : null}
            <span className={`numeric shrink-0 text-base font-semibold leading-none text-text ${row.owed === null ? '' : 'ml-auto'}`}>
              {row.lined}
              <span className="text-sm font-medium text-text-dim">
                {row.owed !== null ? ` of ${row.owed}` : span === 'today' ? ' today' : ' this week'}
              </span>
            </span>
          </span>
          {toDo.length > 0 ? (
            <span className="meta truncate">
              {toDo.map((part, i) => (
                <span key={part.word} className={`font-semibold ${part.text}`}>
                  {i > 0 ? <span className="text-text-dim"> · </span> : null}
                  {part.word}
                </span>
              ))}
            </span>
          ) : null}
          {/* The bar is a picture; this says it. */}
          <span className="sr-only">{breakdown({ ...row.counts, waiting: 0, failed: 0 })}</span>
        </button>
      </li>

      {open ? (
        <li id={panel} className="settle-in col-span-full">
          {row.videos.length === 0 ? (
            <p className="meta rounded-xl bg-white/[0.02] px-3 py-3 text-text-dim">Nothing lined up yet.</p>
          ) : (
            <ul aria-label={`${row.name} videos`} className="flex flex-col divide-y divide-rule rounded-xl bg-white/[0.02] px-3">
              {row.videos.map((video) => (
                <VideoRow key={video.id} video={video} span={span} />
              ))}
            </ul>
          )}
        </li>
      ) : null}
    </Fragment>
  )
}

function Bar({ row, owed }: { row: GoingOutRow; owed: number }) {
  const whole = Math.max(owed, row.lined)
  return (
    <span aria-hidden className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
      <span className="h-full bg-state-posted" style={{ width: `${(row.counts.posted / whole) * 100}%` }} />
      <span className="h-full bg-state-later/45" style={{ width: `${(row.counts.scheduled / whole) * 100}%` }} />
    </span>
  )
}

/** One video on one line: when, where it went, its caption, and where it
 *  stands. Opens the post when it is out. */
function VideoRow({ video, span }: { video: GoingOutVideo; span: GoingOutSpan }) {
  const platforms = [...new Set(video.posts.map((p) => p.platform))]
  // A platform it failed on, while it is out (or due) somewhere else.
  const failedOn = (platform: string) =>
    video.status !== 'failed' && video.posts.filter((p) => p.platform === platform).every((p) => p.status === 'failed')
  const caption = video.caption || video.posts.map((p) => `@${p.handle}`).join(', ')

  const inner = (
    <>
      {/* A column, so the captions start in one place: "8:15 am" and
          "10:15 am" are not the same width. */}
      <span className={`numeric shrink-0 whitespace-nowrap text-sm font-semibold text-text ${span === 'week' ? 'min-w-[7rem]' : 'min-w-[4.75rem]'}`}>
        {when(video.publishedAt, span)}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {platforms.map((platform) => (
          <PlatformGlyph
            key={platform}
            platform={platform}
            className={`h-3.5 w-3.5 ${failedOn(platform) ? 'text-state-blocked' : 'text-text-dim'}`}
          />
        ))}
        <span className="sr-only">
          {platforms.map((platform) => (failedOn(platform) ? `${platform} (failed)` : platform)).join(', ')}
        </span>
      </span>
      <span className={`meta min-w-0 flex-1 truncate ${video.caption ? 'text-text-dim' : 'text-state-later'}`}>{caption}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <StateDot tone={STATUS_TONE[video.status]} />
        <span className={`text-sm font-medium ${STATUS_TEXT[video.status]}`}>{STATUS_WORD[video.status]}</span>
      </span>
    </>
  )

  const line = 'flex items-center gap-2.5 py-2'
  return (
    <li>
      {video.url ? (
        <a href={video.url} target="_blank" rel="noreferrer" className={`${line} transition-opacity duration-200 hover:opacity-80`}>
          {inner}
        </a>
      ) : (
        <div className={line}>{inner}</div>
      )}
    </li>
  )
}
