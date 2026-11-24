// The week, laid out like Google Calendar: a column per day, a row per half
// hour. He picks what he is placing (a recording session, an ideate session,
// the backup day), taps the time it starts, and it lands there at its length.
// Tapping a block takes it off again. In the UGC Roadmap look (roadmap.tsx).

import { useEffect, useRef, useState, type CSSProperties } from 'react'

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
import { HIGHLIGHT, R } from './roadmap'

const FIRST = 6 * 60
const LAST = 24 * 60
const STEP = 30
const ROW = 22

/** Short enough to fit a phone-width column. */
const SEGMENT_SHORT = { trybe: 'Trybe', base: 'Base', media_maxing: 'Media' } as const
const compact = (minute: number) => clock(minute).replace(':00', '').replace(' ', '')

const KIND_STYLE: Record<PlanBlockKind, CSSProperties> = {
  record: { background: HIGHLIGHT, border: '1px solid rgba(255,255,255,0.25)', color: '#fff', boxShadow: '0 6px 18px -8px rgba(72,108,245,0.9)' },
  ideate: { background: 'rgba(134,168,255,0.12)', border: `1px solid ${R.blue}`, color: R.title },
  backup: { background: 'rgba(10,11,14,0.85)', border: `1px dashed ${R.line}`, color: R.dim },
}

const MODES: { kind: PlanBlockKind; label: (recorded: number) => string }[] = [
  // Short, so the three stay one row on a phone; what each is, and that a
  // backup day is not recommended, is said in the line under them.
  { kind: 'record', label: (n) => `Record ${n}/${RECORDING_DAYS}` },
  { kind: 'ideate', label: () => 'Ideate' },
  { kind: 'backup', label: () => 'Backup' },
]

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
  const scroller = useRef<HTMLDivElement>(null)
  const rows = Array.from({ length: (LAST - FIRST) / STEP }, (_, i) => FIRST + i * STEP)
  const recordCount = blocks.filter((b) => b.kind === 'record').length

  // Opens on the part of the day that matters: an hour before his earliest
  // block, or 9 am on an empty week - not on 6 am with the evening hidden.
  useEffect(() => {
    const earliest = blocks.length > 0 ? Math.min(...blocks.map((b) => b.start_minute)) - 60 : 9 * 60
    if (scroller.current) scroller.current.scrollTop = Math.max(0, ((earliest - FIRST) / STEP) * ROW)
    // Only when it first appears: scrolling under his finger as he places
    // blocks would be its own bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="flex flex-col gap-4">
      {readOnly ? null : (
        <>
          <div
            role="group"
            aria-label="What you are placing"
            className="grid grid-cols-3 gap-1 self-start rounded-full p-1"
            style={{ background: '#0F1116', boxShadow: `inset 0 0 0 1px ${R.edge}` }}
          >
            {MODES.map(({ kind, label }) => {
              const on = placing === kind
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPlacing(kind)}
                  className="press min-h-10 whitespace-nowrap rounded-full px-4 text-[13.5px] font-semibold transition-colors duration-200 hover:text-[#F4F3EF]"
                  style={on ? { background: HIGHLIGHT, color: '#fff', boxShadow: '0 6px 16px -8px rgba(72,108,245,0.9)' } : { color: R.body }}
                >
                  {label(recordCount)}
                </button>
              )
            })}
          </div>
          <p className="text-[14px] leading-relaxed" style={{ color: R.body }}>
            <span style={{ color: R.title }}>Tap the time it starts.</span>{' '}
            {placing === 'record'
              ? `A recording session is ${hours(minutesPerDay)}.`
              : placing === 'ideate'
                ? 'An ideate session is 1h, to ideate, A/B test and improve.'
                : `A backup day is ${hours(minutesPerDay)}, for a missed session - not recommended: stick to the plan.`}{' '}
            Tap a block to remove it.
          </p>
          {message ? (
            <p role="status" className="rounded-xl px-4 py-2.5 text-[14px]" style={{ background: 'rgba(240,168,60,0.10)', color: '#F0B860', boxShadow: 'inset 0 0 0 1px rgba(240,168,60,0.3)' }}>
              {message}
            </p>
          ) : null}
        </>
      )}

      <div
        ref={scroller}
        className="max-h-[58vh] overflow-y-auto rounded-2xl"
        style={{ background: 'rgba(15,17,22,0.88)', boxShadow: `inset 0 0 0 1px ${R.edge}, 0 30px 60px -30px rgba(0,0,0,0.8)` }}
      >
        <div
          className="sticky top-0 z-10 grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] backdrop-blur-md"
          style={{ background: 'rgba(15,17,22,0.92)', borderBottom: `1px solid ${R.edge}` }}
        >
          <span />
          {WEEKDAYS_SHORT.map((day) => (
            <span key={day} className="py-3 text-center text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: R.body }}>
              {day}
            </span>
          ))}
        </div>
        <div className="relative grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))]">
          <div>
            {rows.map((minute) => (
              <div key={minute} style={{ height: ROW, color: R.dim }} className="-translate-y-1.5 pr-1.5 text-right text-[10px] leading-none">
                {minute % 60 === 0 ? clock(minute).replace(':00', '') : ''}
              </div>
            ))}
          </div>
          {WEEKDAYS_SHORT.map((day, weekday) => (
            <div key={day} className="relative" style={{ borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
              {rows.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  disabled={readOnly}
                  aria-label={`${day} ${clock(minute)}`}
                  onClick={() => place(weekday, minute)}
                  style={{ height: ROW, borderTop: minute % 60 === 0 ? '1px solid rgba(255,255,255,0.06)' : undefined }}
                  className={`block w-full ${readOnly ? '' : 'transition-colors duration-150 hover:bg-[#86A8FF]/[0.10]'}`}
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
                      ...KIND_STYLE[block.kind],
                      top: ((block.start_minute - FIRST) / STEP) * ROW + 1,
                      height: (block.duration_minutes / STEP) * ROW - 3,
                    }}
                    className={`pop-in absolute inset-x-[3px] overflow-hidden rounded-lg px-1.5 py-1 text-left text-[10px] leading-tight ${readOnly ? '' : 'transition-[filter] hover:brightness-110'}`}
                  >
                    <span className="block font-bold">{compact(block.start_minute)}</span>
                    {block.kind === 'record'
                      ? segmentsFor(block, blocks).map((s) => (
                          <span key={s.kind} className="block opacity-90">
                            {hours(s.duration_minutes)} {SEGMENT_SHORT[s.kind]}
                          </span>
                        ))
                      : <span className="block opacity-90">{block.kind === 'ideate' ? 'Ideate' : 'Backup'}</span>}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
