// The week, laid out like Google Calendar: a column per day, a row per half
// hour. He picks what he is placing (a recording session, an ideate session,
// the backup day), taps the time it starts, and it lands there at its length.
// Tapping a block takes it off again.

import { useState } from 'react'

import type { PlanBlockKind } from '../data'
import {
  KIND_LABEL,
  RECORDING_DAYS,
  WEEKDAYS_SHORT,
  cannotPlace,
  clock,
  durationFor,
  hours,
  segmentsFor,
  type DraftBlock,
} from '../data/weeklyPlan'

const FIRST = 6 * 60
const LAST = 24 * 60
const STEP = 30
const ROW = 22

/** Short enough to fit a phone-width column. */
const SEGMENT_SHORT = { trybe: 'Trybe', base: 'Base', media_maxing: 'Media' } as const
const compact = (minute: number) => clock(minute).replace(':00', '').replace(' ', '')

const KIND_STYLE: Record<PlanBlockKind, string> = {
  record: 'border-state-now bg-surface-raised text-text',
  ideate: 'border-edge-lit bg-surface text-text-dim',
  backup: 'border-dashed border-edge-lit bg-ink text-state-later',
}

export function WeekCalendar({
  blocks,
  minutesPerDay,
  onChange,
  readOnly = false,
}: {
  blocks: DraftBlock[]
  minutesPerDay: number
  onChange?: (next: DraftBlock[]) => void
  readOnly?: boolean
}) {
  const [placing, setPlacing] = useState<PlanBlockKind>('record')
  const [message, setMessage] = useState<string | null>(null)
  const rows = Array.from({ length: (LAST - FIRST) / STEP }, (_, i) => FIRST + i * STEP)
  const recordCount = blocks.filter((b) => b.kind === 'record').length

  function place(weekday: number, start: number) {
    if (readOnly || !onChange) return
    const block: DraftBlock = { kind: placing, weekday, start_minute: start, duration_minutes: durationFor(placing, minutesPerDay) }
    const why = cannotPlace(blocks, block)
    if (why) {
      setMessage(why)
      return
    }
    setMessage(null)
    const next = [...blocks, block]
    onChange(next)
    // Three recording days placed: move him on to ideate days by himself.
    if (placing === 'record' && next.filter((b) => b.kind === 'record').length === RECORDING_DAYS) setPlacing('ideate')
  }

  function remove(block: DraftBlock) {
    if (readOnly || !onChange) return
    setMessage(null)
    onChange(blocks.filter((b) => b !== block))
  }

  return (
    <div className="flex flex-col gap-3">
      {readOnly ? null : (
        <>
          <div role="group" aria-label="What you are placing" className="flex flex-wrap gap-1.5">
            {(['record', 'ideate', 'backup'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={placing === kind}
                onClick={() => setPlacing(kind)}
                className={[
                  'press min-h-tap rounded-full border px-4 text-sm font-semibold',
                  placing === kind ? 'border-state-now bg-surface-raised text-text' : 'border-edge text-state-later active:bg-surface',
                ].join(' ')}
              >
                {kind === 'record'
                  ? `Recording ${recordCount}/${RECORDING_DAYS}`
                  : kind === 'ideate'
                    ? 'Ideate · A/B test'
                    : 'Backup (not recommended)'}
              </button>
            ))}
          </div>
          <p className="meta text-state-later">
            Tap the time it starts.{' '}
            {placing === 'record'
              ? `A recording session is ${hours(minutesPerDay)}.`
              : placing === 'ideate'
                ? 'An ideate session is 1h.'
                : `A backup day is ${hours(minutesPerDay)}, for a missed session.`}{' '}
            Tap a block to remove it.
          </p>
          {message ? <p className="text-sm text-state-waiting">{message}</p> : null}
        </>
      )}

      <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-rule">
        <div className="sticky top-0 z-10 grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] border-b border-rule bg-ink">
          <span />
          {WEEKDAYS_SHORT.map((day) => (
            <span key={day} className="label py-2 text-center text-state-later">
              {day}
            </span>
          ))}
        </div>
        <div className="relative grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))]">
          <div>
            {rows.map((minute) => (
              <div key={minute} style={{ height: ROW }} className="pr-1 text-right text-[10px] leading-none text-state-later">
                {minute % 60 === 0 ? clock(minute).replace(':00', '') : ''}
              </div>
            ))}
          </div>
          {WEEKDAYS_SHORT.map((day, weekday) => (
            <div key={day} className="relative border-l border-rule">
              {rows.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  disabled={readOnly}
                  aria-label={`${day} ${clock(minute)}`}
                  onClick={() => place(weekday, minute)}
                  style={{ height: ROW }}
                  className={`block w-full ${minute % 60 === 0 ? 'border-t border-rule' : ''} ${readOnly ? '' : 'active:bg-surface'}`}
                />
              ))}
              {blocks
                .filter((b) => b.weekday === weekday && b.start_minute >= FIRST)
                .map((block) => (
                  <button
                    key={`${block.kind}-${block.start_minute}`}
                    type="button"
                    disabled={readOnly}
                    onClick={() => remove(block)}
                    aria-label={`${WEEKDAYS_SHORT[weekday]} ${clock(block.start_minute)} ${KIND_LABEL[block.kind]}${readOnly ? '' : ' - tap to remove'}`}
                    style={{
                      top: ((block.start_minute - FIRST) / STEP) * ROW,
                      height: (block.duration_minutes / STEP) * ROW - 2,
                    }}
                    className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[10px] leading-tight ${KIND_STYLE[block.kind]}`}
                  >
                    <span className="block font-semibold">{compact(block.start_minute)}</span>
                    {block.kind === 'record'
                      ? segmentsFor(block, blocks).map((s) => (
                          <span key={s.kind} className="block">
                            {hours(s.duration_minutes)} {SEGMENT_SHORT[s.kind]}
                          </span>
                        ))
                      : <span className="block">{block.kind === 'ideate' ? 'Ideate' : 'Backup'}</span>}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
