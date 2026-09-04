import type { Video } from '../data'
import { formatCents } from '../session'

/** One video, one tap.
 *
 *  The whole row is the target - not a checkbox inside it - because he taps
 *  this one-handed, in a hurry, often with the phone propped against
 *  something. Done rows stay exactly where they are and turn green: he needs
 *  to see what he has done, and a row that vanishes shifts the ones below it
 *  out from under his thumb mid-tap.
 *
 *  Colour is state and nothing else:
 *    green        done
 *    bright white do this one, right now
 *    grey         real work, but not this one
 *    amber        waiting on someone else
 *    red          blocked, with the reason in plain words
 */
export function VideoRow({
  video,
  campaignName,
  done,
  isNext,
  statusLabel,
  rateCents,
  busy,
  onTap,
}: {
  video: Video
  campaignName: string
  done: boolean
  /** The one he should do next. Exactly one row in a list carries this. */
  isNext: boolean
  statusLabel: string
  rateCents: number | null
  busy: boolean
  onTap: () => void
}) {
  const blocked = video.blocked_reason !== null

  const tone = done
    ? 'text-state-posted'
    : blocked
      ? 'text-state-blocked'
      : video.phase === 'submitted'
        ? 'text-state-waiting'
        : isNext
          ? 'text-state-now'
          : 'text-state-later'

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={busy}
      // aria-pressed rather than a checkbox role: the tap toggles a state that
      // is already written down, and tapping again undoes it.
      aria-pressed={done}
      className={[
        'flex min-h-tap w-full items-center gap-3 rounded-lg border px-4 py-3 text-left',
        'active:bg-surface-raised disabled:opacity-60',
        done ? 'border-state-posted/40 bg-state-posted/5' : 'border-edge bg-surface',
      ].join(' ')}
    >
      <span aria-hidden className={`w-6 shrink-0 text-lg leading-none ${tone}`}>
        {done ? '(v)' : '( )'}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-semibold uppercase tracking-wide ${tone}`}>
          {campaignName}
        </span>
        <span className={`truncate text-sm ${blocked ? 'text-state-blocked' : 'text-state-later'}`}>
          {blocked ? video.blocked_reason : statusLabel}
        </span>
      </span>

      <span className={`shrink-0 tabular-nums ${done ? 'text-state-posted' : 'text-state-later'}`}>
        {rateCents === null ? (
          // Unpriced, not free. The rate has not been confirmed for this
          // campaign yet, and a $0 here would read as work worth nothing.
          <span className="text-sm text-state-waiting">no rate yet</span>
        ) : (
          formatCents(rateCents)
        )}
      </span>
    </button>
  )
}
