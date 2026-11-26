// The week, laid out like Google Calendar and starting on Sunday: a column per
// day, a row per half hour. He picks what he is placing (a recording session,
// an ideate session, the backup day) and taps the time it starts - a preview
// follows the pointer first, amber where it cannot go.
//
// A placed block moves along its own day: drag it (it snaps to the quarter
// hour, and the calendar scrolls when it reaches an edge), or tap it and tap
// the new time. Tapping it also offers Remove; with the keyboard, the arrows
// move it and Delete removes it. In the UGC Roadmap look (roadmap.tsx).
//
// A thin red line with a dot at its left end crosses today's column at the
// time it is now, the way a calendar app marks it ("a little red line that
// shows me what hour we are at"). It moves every minute and is on the next
// day's column the next day; before 6 am it is off the calendar.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { PlanBlockKind } from '../data'
import {
  IDEATE_RECOMMENDED,
  KIND_LABEL,
  RECORDING_DAYS,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  WEEK_ORDER,
  cannotMove,
  cannotPlace,
  clock,
  durationFor,
  hours,
  ideateMinutes,
  planWeekday,
  segmentsFor,
  type DraftBlock,
  type SegmentKind,
} from '../data/weeklyPlan'
import { TrashIcon } from './icons'
import { HIGHLIGHT, R } from './roadmap'

const FIRST = 6 * 60
const LAST = 24 * 60
/** A tap places on the half hour; a drag moves by the quarter hour. */
const STEP = 30
const SNAP = 15
/** Pixels per half hour, and the room above 6 am so its label shows. */
const ROW = 26
const PAD = 10
const SLOTS = Array.from({ length: (LAST - FIRST) / STEP }, (_, i) => FIRST + i * STEP)
const HOUR_LINES = Array.from({ length: (LAST - FIRST) / 60 }, (_, i) => FIRST / 60 + i)
const HEIGHT = PAD + ((LAST - FIRST) / STEP) * ROW + PAD

const top = (minute: number) => PAD + ((minute - FIRST) / STEP) * ROW
const tall = (minutes: number) => (minutes / STEP) * ROW
const AMBER = '#F0B860'

/** "6 PM" */
function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

/** "6pm", "6:30pm" */
function shortClock(minute: number): string {
  return clock(minute).replace(':00', '').replace(' ', '')
}

/** "6pm", "6:45" - a phone's block is too narrow for more, and the hours
 *  down the side say which half of the day it is. */
function tinyClock(minute: number): string {
  return minute % 60 === 0 ? shortClock(minute) : clock(minute).split(' ')[0]
}

/** "6 – 8pm", "11:30am – 1:30pm" */
function span(start: number, end: number): string {
  const a = shortClock(start)
  const b = shortClock(end)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)} – ${b}` : `${a} – ${b}`
}

const BAND: Record<SegmentKind, CSSProperties> = {
  trybe: { background: 'linear-gradient(180deg, #8AA6FF 0%, #6C8AF7 100%)' },
  base: { background: 'linear-gradient(180deg, #3F5DE0 0%, #2B45C2 100%)' },
  // Stripes tell the media maxing day apart without a colour of its own.
  media_maxing: {
    background:
      'repeating-linear-gradient(135deg, rgba(255,255,255,0.09) 0 5px, transparent 5px 11px), linear-gradient(180deg, #3654D4 0%, #233AA2 100%)',
  },
}
const BAND_NAME: Record<SegmentKind, string> = { trybe: 'Trybe', base: 'Base UGC', media_maxing: 'Media maxing' }
const BAND_SHORT: Record<SegmentKind, string> = { trybe: 'Trybe', base: 'Base', media_maxing: 'Media' }

const SHELL: Record<PlanBlockKind, CSSProperties> = {
  record: { border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 8px 22px -10px rgba(72,108,245,0.95)' },
  ideate: { background: 'rgba(134,168,255,0.12)', border: '1px solid rgba(134,168,255,0.5)', boxShadow: `inset 3px 0 0 ${R.blue}` },
  backup: { background: 'rgba(255,255,255,0.03)', border: '1px dashed #4A4F5A' },
}

const SWATCH: Record<PlanBlockKind, CSSProperties> = {
  record: { background: HIGHLIGHT },
  ideate: { background: 'rgba(134,168,255,0.2)', boxShadow: `inset 0 0 0 1.5px ${R.blue}` },
  backup: { border: `1.5px dashed ${R.dim}` },
}

const MODES: { kind: PlanBlockKind; label: (blocks: readonly DraftBlock[]) => string }[] = [
  // Short, so the three stay one row on a phone; what each is, and that a
  // backup day is not recommended, is said in the line under them.
  { kind: 'record', label: (blocks) => `Record ${blocks.filter((b) => b.kind === 'record').length}/${RECORDING_DAYS}` },
  { kind: 'ideate', label: (blocks) => (ideateMinutes(blocks) > 0 ? `Ideate ${hours(ideateMinutes(blocks))}` : 'Ideate') },
  { kind: 'backup', label: () => 'Backup' },
]

/** The wall clock to the minute, read again on each minute boundary and
 *  whenever the page comes back into view - a phone that slept for an hour
 *  should not show the hour it went to sleep. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    // To the next whole minute, measured again each time so it never drifts.
    const schedule = () => {
      const current = new Date()
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()))
    }
    schedule()
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return now
}

/** Where the now line goes: today's stored weekday and the minute of the
 *  day, or null when it is before the calendar's first hour. */
function nowMark(now: Date): { weekday: number; minute: number } | null {
  const minute = now.getHours() * 60 + now.getMinutes()
  return minute >= FIRST && minute < LAST ? { weekday: planWeekday(now), minute } : null
}

interface Dragging {
  block: DraftBlock
  startY: number
  startScroll: number
  moved: boolean
  minute: number
  frame: number
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
  const editable = !readOnly && onChange !== undefined
  const [placing, setPlacing] = useState<PlanBlockKind>('record')
  const [message, setMessage] = useState<string | null>(null)
  const [hover, setHover] = useState<{ weekday: number; minute: number } | null>(null)
  const [selected, setSelected] = useState<DraftBlock | null>(null)
  const [drag, setDrag] = useState<{ block: DraftBlock; minute: number; why: string | null } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const dragging = useRef<Dragging | null>(null)
  const pointerY = useRef(0)
  const justDragged = useRef(false)
  const latest = useRef(blocks)
  useEffect(() => {
    latest.current = blocks
  }, [blocks])

  // A block that has since been removed or replaced is no longer picked up.
  const picked = selected && blocks.includes(selected) ? selected : null
  const ideate = ideateMinutes(blocks)
  const mark = nowMark(useMinute())

  // Opens on the part of the day that matters: an hour before his earliest
  // block, or 9 am on an empty week - not on 6 am with the evening hidden.
  // If the now line would be out of sight there, it opens on the now line
  // instead, an hour of the day above it.
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const earliest = blocks.length > 0 ? Math.min(...blocks.map((b) => b.start_minute)) - 60 : 9 * 60
    let target = Math.max(0, tall(earliest - FIRST))
    if (mark && box.clientHeight > 0) {
      // The sticky row of day names takes the top of the box; three rows'
      // room at the bottom keeps the line clear of it and of the edge.
      const line = top(mark.minute)
      if (line < target + ROW || line > target + box.clientHeight - 3 * ROW) target = Math.max(0, tall(mark.minute - 60 - FIRST))
    }
    box.scrollTop = target
    // Only when it first appears: scrolling under his finger as he places
    // blocks, or every minute as the line moves, would be its own bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A picked-up block is put down by a tap anywhere else, or Escape.
  useEffect(() => {
    if (!picked) return
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setSelected(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [picked])

  function place(weekday: number, start: number) {
    if (!onChange) return
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

  function move(block: DraftBlock, start: number) {
    if (!onChange || start === block.start_minute) return
    const why = cannotMove(blocks, block, start)
    if (why) {
      setMessage(why)
      return
    }
    const moved = { ...block, start_minute: start }
    setMessage(null)
    onChange(blocks.map((b) => (b === block ? moved : b)))
    setSelected((current) => (current === block ? moved : current))
  }

  function remove(block: DraftBlock) {
    if (!onChange) return
    setMessage(null)
    setSelected(null)
    onChange(blocks.filter((b) => b !== block))
  }

  function tapSlot(weekday: number, minute: number) {
    if (!editable) return
    if (picked) {
      if (picked.weekday !== weekday) {
        setMessage(`A block moves along its own day - tap a time on ${WEEKDAYS[picked.weekday]}.`)
        return
      }
      move(picked, Math.min(minute, LAST - picked.duration_minutes))
      setSelected(null)
      return
    }
    place(weekday, minute)
  }

  // Dragging. The block follows the pointer down its own column, snapping to
  // the quarter hour; near the top or bottom edge the calendar scrolls with
  // it. Let go somewhere it cannot go and it stays where it was, and says why.
  function follow() {
    const d = dragging.current
    const box = scroller.current
    if (!d || !box) return
    const dy = pointerY.current - d.startY + (box.scrollTop - d.startScroll)
    const raw = d.block.start_minute + (dy / ROW) * STEP
    const minute = Math.min(LAST - d.block.duration_minutes, Math.max(FIRST, Math.round(raw / SNAP) * SNAP))
    if (minute === d.minute && d.moved) return
    d.minute = minute
    setDrag({ block: d.block, minute, why: minute === d.block.start_minute ? null : cannotMove(latest.current, d.block, minute) })
  }

  function edgeScroll() {
    const d = dragging.current
    const box = scroller.current
    if (!d || !box) return
    const { top: upper, bottom: lower } = box.getBoundingClientRect()
    const edge = 44
    const over =
      pointerY.current < upper + edge ? pointerY.current - (upper + edge) : pointerY.current > lower - edge ? pointerY.current - (lower - edge) : 0
    if (over !== 0) {
      box.scrollTop += Math.max(-14, Math.min(14, over / 3))
      follow()
    }
    d.frame = requestAnimationFrame(edgeScroll)
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, block: DraftBlock) {
    justDragged.current = false
    if (!editable || event.button !== 0) return
    try {
      // Keeps the moves coming when the pointer outruns the block.
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // A pointer the browser no longer tracks: the drag still works over it.
    }
    pointerY.current = event.clientY
    dragging.current = {
      block,
      startY: event.clientY,
      startScroll: scroller.current?.scrollTop ?? 0,
      moved: false,
      minute: block.start_minute,
      frame: 0,
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragging.current
    if (!d) return
    pointerY.current = event.clientY
    if (!d.moved) {
      if (Math.abs(event.clientY - d.startY) < 4) return
      setHover(null)
      setMessage(null)
      follow()
      d.moved = true
      d.frame = requestAnimationFrame(edgeScroll)
      return
    }
    follow()
  }

  function endDrag(commit: boolean) {
    const d = dragging.current
    dragging.current = null
    if (!d) return
    cancelAnimationFrame(d.frame)
    setDrag(null)
    if (!d.moved) return
    // The click the browser sends after this release is not a tap. It comes
    // in the same task, so the flag clears itself after - and never eats a
    // later tap when a browser sends no click at all.
    justDragged.current = true
    window.setTimeout(() => {
      justDragged.current = false
    }, 0)
    if (commit) move(d.block, d.minute)
  }

  function onBlockClick(block: DraftBlock) {
    // The click that ends a drag is not a tap.
    if (justDragged.current) {
      justDragged.current = false
      return
    }
    if (!editable) return
    setMessage(null)
    setSelected((current) => (current === block ? null : block))
  }

  function onBlockKey(event: ReactKeyboardEvent<HTMLButtonElement>, block: DraftBlock) {
    if (!editable) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const start = block.start_minute + (event.key === 'ArrowUp' ? -SNAP : SNAP)
      if (start >= FIRST && start + block.duration_minutes <= LAST) move(block, start)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove(block)
    }
  }

  // What would land where the pointer is: the block he is placing, or the
  // picked-up one moved there. Mouse only - a finger has no hover.
  const ghost = (() => {
    if (!editable || !hover || drag) return null
    if (picked) {
      if (picked.weekday !== hover.weekday) return null
      const start = Math.min(hover.minute, LAST - picked.duration_minutes)
      if (start === picked.start_minute) return null
      return { weekday: hover.weekday, start, kind: picked.kind, duration: picked.duration_minutes, why: cannotMove(blocks, picked, start) }
    }
    const block: DraftBlock = { kind: placing, weekday: hover.weekday, start_minute: hover.minute, duration_minutes: durationFor(placing, minutesPerDay) }
    return { weekday: hover.weekday, start: hover.minute, kind: placing, duration: block.duration_minutes, why: cannotPlace(blocks, block) }
  })()

  const hint =
    placing === 'record'
      ? `Tap the time your ${hours(minutesPerDay)} recording session starts. Three days, one session a day.`
      : placing === 'ideate'
        ? `Ideate ${IDEATE_RECOMMENDED.min / 60} to ${IDEATE_RECOMMENDED.max / 60} hours a week, on days you don't record. Each tap adds 1 hour.`
        : 'One backup day, for a missed session. Not recommended - stick to the plan.'

  return (
    <div ref={root} className="flex flex-col gap-4">
      {editable ? (
        <div className="flex flex-col gap-3">
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
                  onClick={() => {
                    setPlacing(kind)
                    setSelected(null)
                    setMessage(null)
                  }}
                  className="press flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13.5px] font-semibold transition-colors duration-200 hover:text-[#F4F3EF] sm:px-4"
                  style={on ? { background: 'rgba(134,168,255,0.16)', color: R.title, boxShadow: `inset 0 0 0 1px rgba(134,168,255,0.45)` } : { color: R.body }}
                >
                  <span aria-hidden className="hidden size-2.5 shrink-0 rounded-[3px] sm:block" style={SWATCH[kind]} />
                  {label(blocks)}
                </button>
              )
            })}
          </div>

          {picked ? (
            <div
              className="settle-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl py-2.5 pl-4 pr-2.5"
              style={{ background: 'rgba(134,168,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.3)' }}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={SWATCH[picked.kind]} />
              <p className="min-w-0 flex-1 text-[14px] leading-snug" style={{ color: R.body }}>
                <span className="font-semibold" style={{ color: R.title }}>
                  {WEEKDAYS[picked.weekday]} · {span(picked.start_minute, picked.start_minute + picked.duration_minutes)}
                </span>{' '}
                - drag it, or tap a new time on {WEEKDAYS[picked.weekday]}.
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => remove(picked)}
                  className="press inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200 hover:bg-[#F2564C]/10 hover:text-[#FF8A80]"
                  style={{ color: R.body, boxShadow: `inset 0 0 0 1px ${R.edge}` }}
                >
                  <TrashIcon aria-hidden className="h-3.5 w-3.5" />
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="press inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200 hover:bg-white/[0.05]"
                  style={{ color: R.title }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-[14px] leading-relaxed" style={{ color: R.body }}>
                <span style={{ color: R.title }}>{hint}</span>
                {blocks.length > 0 ? ' Drag a block to move it, or tap it to remove it.' : null}
              </p>
              {placing === 'ideate' ? (
                <span
                  className="rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums"
                  style={
                    ideate >= IDEATE_RECOMMENDED.min && ideate <= IDEATE_RECOMMENDED.max
                      ? { background: 'rgba(134,168,255,0.14)', color: R.blue, boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.35)' }
                      : { color: R.dim, boxShadow: `inset 0 0 0 1px ${R.edge}` }
                  }
                >
                  {ideate > 0 ? hours(ideate) : '0h'} · {IDEATE_RECOMMENDED.min / 60}–{IDEATE_RECOMMENDED.max / 60}h recommended
                </span>
              ) : null}
            </div>
          )}

          {message ? (
            <p
              role="status"
              className="rounded-xl px-4 py-2.5 text-[14px]"
              style={{ background: 'rgba(240,168,60,0.10)', color: AMBER, boxShadow: 'inset 0 0 0 1px rgba(240,168,60,0.3)' }}
            >
              {message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scroller}
        className="max-h-[min(62vh,640px)] overflow-y-auto overscroll-contain rounded-2xl"
        style={{
          background: 'rgba(13,15,20,0.92)',
          boxShadow: `inset 0 0 0 1px ${R.edge}, 0 30px 60px -30px rgba(0,0,0,0.85)`,
          scrollbarWidth: 'thin',
          scrollbarColor: `${R.edge} transparent`,
        }}
      >
        {/* Inside the scroller, so its columns line up with the grid's
            whatever the scrollbar takes. */}
        <div
          className="sticky top-0 z-40 grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] backdrop-blur-md sm:grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]"
          style={{ background: 'rgba(13,15,20,0.9)', borderBottom: `1px solid ${R.edge}` }}
        >
          <span />
          {WEEK_ORDER.map((weekday) => {
            const kinds = new Set(blocks.filter((b) => b.weekday === weekday).map((b) => b.kind))
            return (
              <span key={weekday} aria-current={mark?.weekday === weekday ? 'date' : undefined} className="flex flex-col items-center gap-1.5 pb-2.5 pt-3">
                <span
                  className="text-[10.5px] font-bold uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.18em]"
                  // Today in the now line's red, the way a calendar marks it.
                  style={{ color: mark?.weekday === weekday ? 'var(--color-state-blocked)' : kinds.size > 0 ? R.title : R.dim }}
                >
                  {WEEKDAYS_SHORT[weekday]}
                </span>
                {/* The day at a glance: filled for recording, a ring for ideating. */}
                <span aria-hidden className="flex h-1.5 items-center gap-1">
                  {kinds.has('record') ? <span className="size-1.5 rounded-full" style={{ background: R.blue, boxShadow: '0 0 8px rgba(134,168,255,0.8)' }} /> : null}
                  {kinds.has('ideate') ? <span className="size-1.5 rounded-full" style={{ boxShadow: `inset 0 0 0 1.25px ${R.blue}` }} /> : null}
                  {kinds.has('backup') ? <span className="size-1.5 rounded-full" style={{ boxShadow: `inset 0 0 0 1.25px ${R.dim}` }} /> : null}
                </span>
              </span>
            )
          })}
        </div>

        <div className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]" style={{ height: HEIGHT }}>
          <div aria-hidden className="relative">
            {HOUR_LINES.map((h) => (
              <span
                key={h}
                className="absolute right-1 text-[9px] font-medium leading-none tabular-nums sm:right-2.5 sm:text-[10.5px]"
                style={{ top: top(h * 60) - 5, color: R.dim }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>

          {WEEK_ORDER.map((weekday, column) => {
            const own = blocks.filter((b) => b.weekday === weekday && b.start_minute >= FIRST)
            const lit = picked?.weekday === weekday || drag?.block.weekday === weekday
            return (
              <div
                key={weekday}
                className="relative"
                onPointerLeave={() => setHover(null)}
                style={{
                  borderLeft: '1px solid rgba(255,255,255,0.05)',
                  backgroundColor: lit ? 'rgba(134,168,255,0.045)' : undefined,
                  backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.075) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.028) 1px, transparent 1px)',
                  backgroundSize: `100% ${ROW * 2}px, 100% ${ROW}px`,
                  backgroundPosition: `0 ${PAD}px, 0 ${PAD}px`,
                  transition: 'background-color 200ms',
                }}
              >
                <div style={{ paddingTop: PAD }}>
                  {SLOTS.map((minute) => (
                    <button
                      key={minute}
                      type="button"
                      disabled={!editable}
                      aria-label={`${WEEKDAYS_SHORT[weekday]} ${clock(minute)}`}
                      onClick={() => tapSlot(weekday, minute)}
                      onPointerEnter={(event) => {
                        if (event.pointerType === 'mouse') setHover({ weekday, minute })
                      }}
                      onFocus={() => setHover({ weekday, minute })}
                      onBlur={() => setHover(null)}
                      style={{ height: ROW }}
                      className="block w-full focus-visible:outline-none"
                    />
                  ))}
                </div>

                {ghost && ghost.weekday === weekday ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-[2px] sm:inset-x-[3px] z-[5] overflow-hidden rounded-[9px] px-1.5 py-1"
                    style={{
                      top: top(ghost.start) + 1,
                      height: tall(ghost.duration) - 2,
                      border: `1.5px dashed ${ghost.why ? 'rgba(240,184,96,0.75)' : 'rgba(134,168,255,0.75)'}`,
                      background: ghost.why ? 'rgba(240,168,60,0.07)' : 'rgba(101,133,245,0.12)',
                    }}
                  >
                    <span className="block truncate text-[10.5px] font-semibold tabular-nums" style={{ color: ghost.why ? AMBER : R.blue }}>
                      {ghost.why ? 'Not here' : shortClock(ghost.start)}
                    </span>
                  </div>
                ) : null}

                {drag && drag.block.weekday === weekday ? (
                  <>
                    {/* Where it was, while it is in the air. */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-[2px] sm:inset-x-[3px] z-[5] rounded-[9px]"
                      style={{
                        top: top(drag.block.start_minute) + 1,
                        height: tall(drag.block.duration_minutes) - 2,
                        border: '1.5px dashed rgba(134,168,255,0.4)',
                      }}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute z-50 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums shadow-lg"
                      style={{
                        top: top(drag.minute) - 28,
                        ...(column === 0 ? { left: 2 } : column === 6 ? { right: 2 } : { left: '50%', transform: 'translateX(-50%)' }),
                        background: drag.why ? AMBER : R.title,
                        color: R.bg,
                      }}
                    >
                      {drag.why ? 'Taken' : span(drag.minute, drag.minute + drag.block.duration_minutes)}
                    </span>
                  </>
                ) : null}

                {mark && mark.weekday === weekday ? (
                  // Over the blocks, under one being dragged; never in the
                  // way of a tap or a drag.
                  <div
                    aria-hidden
                    data-now-line
                    className="pointer-events-none absolute inset-x-0 z-[25] h-0"
                    style={{ top: top(mark.minute) }}
                  >
                    <span className="absolute inset-x-0 -top-px h-[2px] bg-state-blocked shadow-[0_0_6px_0_color-mix(in_oklab,var(--color-state-blocked)_60%,transparent)]" />
                    <span className="absolute -left-[5px] -top-[5px] size-[10px] rounded-full bg-state-blocked" />
                  </div>
                ) : null}

                {own.map((block) => {
                  const index = blocks.indexOf(block)
                  const inAir = drag?.block === block
                  const start = inAir ? drag.minute : block.start_minute
                  const isPicked = picked === block
                  const ring = inAir && drag.why ? `0 0 0 2px ${AMBER}` : isPicked ? `0 0 0 2px ${R.title}` : null
                  const shell = SHELL[block.kind]
                  return (
                    <button
                      key={`block-${index}`}
                      type="button"
                      disabled={!editable}
                      aria-label={`${WEEKDAYS_SHORT[weekday]} ${clock(block.start_minute)} ${KIND_LABEL[block.kind]}${editable ? ' - drag to move, tap for remove' : ''}`}
                      aria-pressed={editable ? isPicked : undefined}
                      onPointerDown={(event) => onPointerDown(event, block)}
                      onPointerMove={onPointerMove}
                      onPointerUp={() => endDrag(true)}
                      onPointerCancel={() => endDrag(false)}
                      onClick={() => onBlockClick(block)}
                      onKeyDown={(event) => onBlockKey(event, block)}
                      className={`@container absolute inset-x-[2px] sm:inset-x-[3px] select-none overflow-hidden rounded-[9px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#86A8FF] ${
                        inAir ? 'z-30 cursor-grabbing' : isPicked ? 'z-20' : 'z-10'
                      } ${editable && !inAir ? 'cursor-grab transition-[filter,box-shadow,scale] duration-150 hover:brightness-110' : ''} pop-in`}
                      style={{
                        ...shell,
                        top: top(start) + 1,
                        height: tall(block.duration_minutes) - 2,
                        touchAction: editable ? 'none' : undefined,
                        // `scale`, not transform: pop-in's held keyframe owns transform.
                        scale: inAir ? '1.03' : undefined,
                        boxShadow: [ring, inAir ? '0 22px 44px -14px rgba(0,0,0,0.9)' : null, shell.boxShadow].filter(Boolean).join(', ') || undefined,
                      }}
                    >
                      <BlockFace block={block} start={start} blocks={blocks} />
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** What a block says: its time, and for a recording session its two parts as
 *  bands - Trybe first - with full names when the column is wide enough. */
function BlockFace({ block, start, blocks }: { block: DraftBlock; start: number; blocks: readonly DraftBlock[] }) {
  const end = start + block.duration_minutes
  const time = (
    <>
      <span className="@min-[76px]:hidden">{tinyClock(start)}</span>
      <span className="hidden @min-[76px]:inline">{span(start, end)}</span>
    </>
  )

  if (block.kind === 'record') {
    return (
      <span className="flex h-full flex-col">
        {segmentsFor(block, blocks).map((segment, i) => (
          <span
            key={segment.kind}
            className="flex min-h-0 flex-col overflow-hidden px-[3px] py-1 tracking-tight @min-[76px]:px-2 @min-[76px]:tracking-normal"
            style={{ ...BAND[segment.kind], flex: segment.duration_minutes, borderTop: i > 0 ? '1px solid rgba(255,255,255,0.25)' : undefined }}
          >
            {i === 0 ? <span className="block truncate text-[9.5px] font-bold leading-tight tabular-nums text-white @min-[76px]:text-[11px]">{time}</span> : null}
            <span className="block truncate text-[9.5px] font-semibold leading-tight text-white/90 @min-[76px]:text-[10.5px]">
              <span className="@min-[76px]:hidden">{BAND_SHORT[segment.kind]}</span>
              <span className="hidden @min-[76px]:inline">
                {hours(segment.duration_minutes)} {BAND_NAME[segment.kind]}
              </span>
            </span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <span className="flex h-full flex-col px-[3px] py-1 tracking-tight @min-[76px]:px-2 @min-[76px]:tracking-normal">
      <span className="block truncate text-[9.5px] font-bold leading-tight @min-[76px]:text-[11px]" style={{ color: block.kind === 'ideate' ? R.title : R.body }}>
        {block.kind === 'ideate' ? 'Ideate' : 'Backup'}
      </span>
      <span className="block truncate text-[9.5px] leading-tight tabular-nums @min-[76px]:text-[10.5px]" style={{ color: block.kind === 'ideate' ? R.body : R.dim }}>
        {time}
      </span>
    </span>
  )
}
