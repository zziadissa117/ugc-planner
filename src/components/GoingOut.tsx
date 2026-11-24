// GOING OUT - every post going out today, or this week, as Postiz has it:
// scheduled ones waiting for their time, ones already out, ones that failed.
// The cutter has this list; TODAY now does too ("Under My Week, you're going
// to have to put Going Out Today").
//
// Read only. It never ticks a Post box - ticking stays his own tap
// (CLAUDE.md). Read from his own Postiz with the key saved in SETUP
// (src/sync/postizPosts.ts); without one, it says where to add it.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { PostizPostView, PostizPostsAnswer } from '../sync/postizPosts'
import { loadPostizPosts } from '../sync/postizPosts'
import { dayBounds, weekBounds } from '../todaySchedule'
import { PlatformGlyph } from './icons'
import { CARD_CLASS } from './styles'
import { SectionLabel, StateDot } from './ui'

type Span = 'today' | 'week'

const STATUS_WORD: Record<PostizPostView['status'], string> = {
  scheduled: 'Scheduled',
  posted: 'Out',
  failed: 'Failed',
}

function time(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')
}

function dayName(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { weekday: 'long' })
}

/** The first line of a caption, short. */
function firstLine(caption: string): string {
  const line = caption.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

export function GoingOut({ now, load = loadPostizPosts }: { now: Date; load?: typeof loadPostizPosts }) {
  const [span, setSpan] = useState<Span>('today')
  // The range moves with the day, not with every half-minute clock tick.
  const dayKey = now.toDateString()
  const key = `${span}:${dayKey}`
  // Each answer is kept with the range it answers, so switching ranges reads
  // as loading until the new one lands - no flash of the old list.
  const [found, setFound] = useState<{ key: string; answer: PostizPostsAnswer | null } | null>(null)
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  useEffect(() => {
    if (offline) return
    let cancelled = false
    const bounds = span === 'today' ? dayBounds(new Date(dayKey)) : weekBounds(new Date(dayKey))
    load({ from: bounds.from.toISOString(), to: bounds.to.toISOString() })
      .then((answer) => {
        if (!cancelled) setFound({ key, answer })
      })
      .catch((error: unknown) => {
        if (!cancelled) setFound({ key, answer: { connected: true, posts: [], reading: 0, error: error instanceof Error ? error.message : String(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [span, dayKey, key, load, offline])

  const answer: PostizPostsAnswer | null | 'loading' | 'offline' = offline ? 'offline' : found?.key === key ? found.answer : 'loading'

  const posts =
    answer !== null && typeof answer === 'object'
      ? [...answer.posts].filter((p) => p.status !== 'failed' || p.publishedAt !== null).sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
      : []

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

      <div className={`${CARD_CLASS} px-5`}>
        {answer === 'loading' ? (
          <p className="py-4 text-base text-state-later">Checking Postiz…</p>
        ) : answer === 'offline' ? (
          <p className="py-4 text-base text-state-later">Offline - this list needs a connection.</p>
        ) : answer === null ? (
          <p className="py-4 text-base text-state-later">Sign in to see what's going out.</p>
        ) : !answer.connected ? (
          <p className="py-4 text-base text-text-dim">
            <Link to="/settings" className="font-semibold text-brand hover:text-text">
              Add your Postiz key
            </Link>{' '}
            to see what's going out.
          </p>
        ) : posts.length === 0 ? (
          <p className="py-4 text-base text-state-later">
            {answer.error ? answer.error : span === 'today' ? 'Nothing going out today.' : 'Nothing going out this week.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {posts.map((post, i) => {
              const showDay = span === 'week' && dayName(post.publishedAt) !== dayName(posts[i - 1]?.publishedAt ?? null)
              const row = (
                <>
                  <span className="numeric w-16 shrink-0 text-base font-semibold text-text">{time(post.publishedAt)}</span>
                  <PlatformGlyph platform={post.platform} className="h-4 w-4 shrink-0 text-text-dim" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base text-text">@{post.handle}</span>
                    {firstLine(post.caption) ? <span className="meta truncate text-state-later">{firstLine(post.caption)}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StateDot tone={post.status === 'posted' ? 'posted' : post.status === 'failed' ? 'blocked' : 'later'} />
                    <span className={`meta ${post.status === 'failed' ? 'text-state-blocked' : 'text-state-later'}`}>{STATUS_WORD[post.status]}</span>
                  </span>
                </>
              )
              return (
                <li key={post.id} className="flex flex-col">
                  {showDay ? <span className="kicker pt-4">{dayName(post.publishedAt)}</span> : null}
                  {post.url ? (
                    <a href={post.url} target="_blank" rel="noreferrer" className="flex min-h-tap items-center gap-3 py-2 transition-opacity hover:opacity-80">
                      {row}
                    </a>
                  ) : (
                    <div className="flex min-h-tap items-center gap-3 py-2">{row}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
