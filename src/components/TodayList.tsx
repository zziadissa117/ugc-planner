// The day's to-do list, on the home screen above FILM and POST: his
// dictation, sorted by the model into one list, most important first. The
// first open line is "do this now" - the one bright white thing in it; the
// rest are grey. Rules in src/dayList.ts.
//
// Every row stays where it is when ticked: done ones turn green in place and
// only move under "Done" the next day.

import { useCallback, useEffect, useState } from 'react'

import { loadPriorities } from '../priorities'
import {
  addLine,
  dayOf,
  editText,
  forToday,
  loadDayList,
  move,
  remove,
  replaceWith,
  saveDayList,
  tick,
  tickStep,
  view,
  type DayItem,
  type DayList,
} from '../dayList'
import { SortDayError, sortDay } from '../dayPlan'
import { CheckIcon, ChevronDownIcon, CloseIcon } from './icons'
import { INPUT_CLASS } from './styles'
import { Button, Disclosure, SectionLabel } from './ui'

const DRAFT_KEY = 'ugc-planner.day-draft'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function TodayList() {
  const [list, setListState] = useState<DayList>(() => loadDayList(storage(), () => loadPriorities(storage())))
  const [draft, setDraft] = useState(() => storage()?.getItem(DRAFT_KEY) ?? '')
  const [pasting, setPasting] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [line, setLine] = useState('')

  const setList = useCallback((change: (current: DayList) => DayList) => {
    setListState((current) => {
      const next = change(current)
      saveDayList(storage(), next)
      return next
    })
  }, [])

  // A new day while the screen is open: every-day items start unticked.
  useEffect(() => {
    const timer = window.setInterval(() => setList((current) => forToday(current)), 60_000)
    return () => window.clearInterval(timer)
  }, [setList])

  const keepDraft = (text: string) => {
    setDraft(text)
    try {
      storage()?.setItem(DRAFT_KEY, text)
    } catch {
      /* the draft just isn't kept */
    }
  }

  const sort = async () => {
    const text = draft.trim()
    if (!text) return
    const open = list.items.filter((i) => !(i.repeat === 'once' && i.done)).length
    if (open > 0 && !window.confirm(`Replace the ${open} open thing${open === 1 ? '' : 's'} on your list with this?`)) return
    setSorting(true)
    setProblem(null)
    try {
      const answer = await sortDay(text, dayOf(new Date()))
      setList((current) => replaceWith(current, answer, answer.model))
      keepDraft('')
      setPasting(false)
    } catch (error) {
      setProblem(
        error instanceof SortDayError
          ? `${error.message} Your text is kept.`
          : `It couldn't be sorted - check the connection and try again. Your text is kept.`,
      )
    } finally {
      setSorting(false)
    }
  }

  const shown = view(list)
  const firstOpen = shown.open.find((i) => !i.done)?.id
  const nothing = list.items.length === 0

  return (
    <section className="flex flex-col gap-2" aria-label="Today's list">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <SectionLabel trailing={nothing ? undefined : `${shown.doneToday} of ${shown.total} done`}>Today</SectionLabel>
        </div>
        {nothing ? null : (
          <Button variant="ghost" size="small" aria-pressed={editing} onClick={() => setEditing((on) => !on)}>
            {editing ? 'Done editing' : 'Edit'}
          </Button>
        )}
      </div>

      {shown.open.length > 0 ? (
        <ul className="flex flex-col divide-y divide-rule" aria-label="To do">
          {shown.open.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              now={item.id === firstOpen}
              editing={editing}
              first={index === 0}
              last={index === shown.open.length - 1}
              onChange={setList}
            />
          ))}
        </ul>
      ) : null}

      {editing ? (
        <div className="flex gap-2">
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && line.trim()) {
                setList((c) => addLine(c, line))
                setLine('')
              }
            }}
            placeholder="Add a line by hand"
            aria-label="Add a line by hand"
            className={`${INPUT_CLASS} min-w-0 flex-1`}
          />
          <Button
            disabled={!line.trim()}
            onClick={() => {
              setList((c) => addLine(c, line))
              setLine('')
            }}
          >
            Add
          </Button>
        </div>
      ) : null}

      {list.model && !nothing ? (
        <p className="meta text-state-later">
          Sorted by Claude ({list.model}) from what you dictated - reorder anything under Edit.
        </p>
      ) : null}
      {list.skipped.length > 0 ? (
        <Disclosure summary="Left out - nothing to do" trailing={String(list.skipped.length)}>
          <ul className="flex flex-col gap-1 pb-2">
            {list.skipped.map((s) => (
              <li key={s} className="text-sm text-state-later">
                {s}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {pasting || nothing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => keepDraft(e.target.value)}
            rows={nothing ? 5 : 8}
            placeholder="Paste what you dictated - everything you have to do today or this week. It comes back as one list, most important first."
            aria-label="Your dictation"
            className={`${INPUT_CLASS} min-h-32 text-base`}
          />
          {problem ? (
            <p role="alert" className="text-sm text-state-blocked">
              {problem}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="now" disabled={!draft.trim() || sorting} onClick={() => void sort()} className="flex-1">
              {sorting ? 'Sorting…' : 'Sort it'}
            </Button>
            {nothing ? null : (
              <Button variant="ghost" onClick={() => setPasting(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="small" className="self-start" onClick={() => setPasting(true)}>
          Paste a new dictation
        </Button>
      )}

      {shown.finished.length > 0 ? (
        <Disclosure summary="Done" trailing={String(shown.finished.length)}>
          <ul className="flex flex-col divide-y divide-rule">
            {shown.finished.map((item) => (
              <li key={item.id} className="flex min-h-tap items-center gap-3 py-1.5">
                <Tick done label={item.text} onClick={() => setList((c) => tick(c, item.id, false))} />
                <span className="min-w-0 flex-1 text-base text-state-later line-through">{item.text}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  )
}

function Row({
  item,
  now,
  editing,
  first,
  last,
  onChange,
}: {
  item: DayItem
  now: boolean
  editing: boolean
  first: boolean
  last: boolean
  onChange: (change: (current: DayList) => DayList) => void
}) {
  const [text, setText] = useState(item.text)
  const tone = item.done ? 'text-state-posted' : now ? 'text-state-now' : 'text-state-later'
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-start gap-3">
        <Tick done={item.done} big={now} label={item.text} onClick={() => onChange((c) => tick(c, item.id, !item.done))} />
        <div className="min-w-0 flex-1 pt-1.5">
          {editing ? (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => onChange((c) => editText(c, item.id, text))}
              aria-label={`Edit ${item.text}`}
              className={`${INPUT_CLASS} w-full`}
            />
          ) : (
            <p className={`text-lg leading-snug ${tone} ${item.done ? 'line-through' : ''}`}>{item.text}</p>
          )}
          <p className="meta text-state-later">
            {[item.repeat === 'daily' ? 'every day' : null, item.deadline ? item.deadline : null, item.why ?? null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {editing ? (
          <div className="flex shrink-0 items-center">
            <IconButton label={`Move ${item.text} up`} disabled={first} onClick={() => onChange((c) => move(c, item.id, -1))}>
              <ChevronDownIcon className="h-5 w-5 rotate-180" />
            </IconButton>
            <IconButton label={`Move ${item.text} down`} disabled={last} onClick={() => onChange((c) => move(c, item.id, 1))}>
              <ChevronDownIcon className="h-5 w-5" />
            </IconButton>
            <IconButton label={`Remove ${item.text}`} onClick={() => onChange((c) => remove(c, item.id))}>
              <CloseIcon className="h-5 w-5" />
            </IconButton>
          </div>
        ) : null}
      </div>
      {item.steps.length > 0 ? (
        <ul className="ml-12 flex flex-col">
          {item.steps.map((step, i) => (
            <li key={`${step.text}-${i}`} className="flex min-h-tap items-center gap-3">
              <Tick small done={step.done} label={step.text} onClick={() => onChange((c) => tickStep(c, item.id, i, !step.done))} />
              <span className={`min-w-0 flex-1 text-base ${step.done ? 'text-state-posted line-through' : 'text-text'}`}>{step.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Tick({
  done,
  label,
  onClick,
  big = false,
  small = false,
}: {
  done: boolean
  label: string
  onClick: () => void
  big?: boolean
  small?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={`Mark ${label} ${done ? 'not done' : 'done'}`}
      aria-pressed={done}
      onClick={onClick}
      className="press -m-2 flex size-12 shrink-0 items-center justify-center"
    >
      <span
        className={`flex items-center justify-center rounded-full border ${big ? 'size-8 border-state-now/80' : small ? 'size-6' : 'size-7'} ${
          done ? 'border-state-posted text-state-posted' : big ? '' : 'border-edge-lit'
        }`}
      >
        {done ? <CheckIcon className="draw-check h-5 w-5" strokeWidth={2.25} /> : null}
      </span>
    </button>
  )
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press flex size-11 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface disabled:opacity-30"
    >
      {children}
    </button>
  )
}
