// One "notes for the next recording" box on IDEATE: an account's, or the
// campaign's as a whole, for the week shown.
//
// What he writes is his - typed by him, edited and deleted freely
// (ideate_notes). It saves on this device first, through the data layer, and
// reaches the server through the outbox afterwards: Save never waits on a
// network, and leaving the box saves what is in it, so switching week or
// closing the tab does not lose a half-written note.

import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react'

import type { IdeateNote } from '../data'
import { IDEATE_NOTE_MAX_LENGTH } from '../data/constraints'
import { plainError } from '../data/errorText'
import { weekName, weekRange } from '../data/ideate'
import { useData } from '../data/useData'
import { INPUT_CLASS } from './styles'
import { Button } from './ui'

export interface NoteBoxHandle {
  /** Adds a line to the end of the note and puts the cursor after it - how a
   *  post's "Write a note about it" lands here. */
  append(text: string): void
}

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }

const length = (text: string) => Array.from(text).length

export function IdeateNoteBox({
  campaignId,
  accountId,
  weekStart,
  thisWeek,
  earlier,
  label,
  placeholder,
  onChanged,
  onOpenWeek,
  handle,
}: {
  campaignId: string
  accountId: string | null
  weekStart: string
  /** This scope's notes for the week shown, most recently edited first. */
  thisWeek: readonly IdeateNote[]
  /** This scope's notes from the weeks before, newest week first. */
  earlier: readonly { weekStart: string; notes: readonly IdeateNote[] }[]
  label: string
  placeholder: string
  onChanged: () => Promise<void>
  onOpenWeek: (weekStart: string) => void
  handle?: Ref<NoteBoxHandle>
}) {
  const data = useData()
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)

  // The box edits the most recent note for the week. Any other note saved
  // for the same week (two devices, offline at once) is listed under it,
  // never merged into it.
  const [primary, ...others] = thisWeek
  const stored = primary?.body ?? ''
  const [pendingId, setPendingId] = useState(() => crypto.randomUUID())
  const noteId = primary?.id ?? pendingId

  const [draft, setDraft] = useState(stored)
  // What the box last saw stored, and what it last saved itself - so a note
  // arriving by sync replaces an untouched box, and never one he is typing in.
  const [seen, setSeen] = useState(stored)
  const [committed, setCommitted] = useState<string | null>(null)
  if (stored !== seen) {
    setSeen(stored)
    setCommitted(null)
    if (draft.trim() === (committed ?? seen)) setDraft(stored)
  }
  const current = committed ?? stored
  const body = draft.trim()
  const dirty = body !== current
  const tooLong = length(body) > IDEATE_NOTE_MAX_LENGTH

  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Leaving the box and tapping Save are one gesture: the blur saves, and the
  // tap that follows must not save the same words a second time.
  const saving = useRef<string | null>(null)
  const lastSaved = useRef(stored)
  useEffect(() => {
    lastSaved.current = stored
  }, [stored])

  async function save() {
    if (body === '' || tooLong || body === lastSaved.current || saving.current === body) return
    saving.current = body
    try {
      await data.saveIdeateNote({ id: noteId, campaign_id: campaignId, account_id: accountId, week_start: weekStart, body })
      lastSaved.current = body
      setCommitted(body)
      setStatus({ kind: 'saved' })
      await onChanged()
    } catch (error) {
      setStatus({ kind: 'error', message: plainError(error) })
    } finally {
      saving.current = null
    }
  }

  async function remove(note: IdeateNote) {
    try {
      await data.deleteIdeateNote(note.id)
      if (note.id === primary?.id) {
        lastSaved.current = ''
        setDraft('')
        setCommitted('')
        setPendingId(crypto.randomUUID())
      }
      setStatus({ kind: 'idle' })
      await onChanged()
    } catch (error) {
      setStatus({ kind: 'error', message: plainError(error) })
    }
  }

  useImperativeHandle(handle, () => ({
    append(text: string) {
      setDraft((d) => (d.trim() === '' ? text : `${d.replace(/\s+$/, '')}\n${text}`))
      setStatus({ kind: 'idle' })
      requestAnimationFrame(() => {
        const el = area.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    },
  }))

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void save()
    }
  }

  const line =
    status.kind === 'error' ? (
      <span className="text-state-blocked">That didn't save: {status.message}</span>
    ) : tooLong ? (
      <span className="text-state-blocked">
        Too long to save: {length(body).toLocaleString('en-US')} of {IDEATE_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.
      </span>
    ) : dirty && body === '' ? (
      'Empty notes are not saved. Delete it, or type to keep it.'
    ) : dirty ? (
      'Not saved yet'
    ) : status.kind === 'saved' ? (
      'Saved'
    ) : null

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="kicker">
        {label}
      </label>
      <textarea
        id={id}
        ref={area}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setStatus({ kind: 'idle' })
        }}
        onBlur={() => void save()}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={3}
        className={`${INPUT_CLASS} min-h-28 w-full resize-y py-3 text-base leading-relaxed`}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p aria-live="polite" className="meta min-w-0 flex-1 text-state-later">
          {line}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {primary ? <DeleteButton onConfirm={() => void remove(primary)} /> : null}
          <Button
            variant={dirty && body !== '' && !tooLong ? 'now' : 'quiet'}
            size="small"
            disabled={!dirty || body === '' || tooLong}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>

      {others.length > 0 ? (
        <div className="flex flex-col gap-2 pt-1">
          <p className="label text-state-later">Also saved for this week</p>
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {others.map((note) => (
              <li key={note.id} className="flex items-start gap-3 py-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-base text-text-dim">{note.body}</p>
                <DeleteButton onConfirm={() => void remove(note)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {earlier.length > 0 ? (
        <details className="group/earlier pt-1">
          <summary className="meta flex min-h-10 cursor-pointer list-none items-center gap-2 text-state-later [&::-webkit-details-marker]:hidden">
            <span className="underline decoration-edge-lit underline-offset-4 group-open/earlier:no-underline">
              Earlier notes ({earlier.length} {earlier.length === 1 ? 'week' : 'weeks'})
            </span>
          </summary>
          <ul className="settle-in flex flex-col divide-y divide-rule border-y border-rule">
            {earlier.map((week) => (
              <li key={week.weekStart} className="flex flex-col gap-2 py-3">
                <button
                  type="button"
                  onClick={() => onOpenWeek(week.weekStart)}
                  className="label self-start text-left text-state-later underline decoration-edge-lit underline-offset-4 hover:text-text"
                >
                  {earlierTitle(week.weekStart)}
                </button>
                {week.notes.map((note) => (
                  <p key={note.id} className="whitespace-pre-wrap break-words text-base text-text-dim">
                    {note.body}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function earlierTitle(weekStart: string): string {
  const name = weekName(weekStart)
  const range = weekRange(weekStart)
  return name === range ? range : `${name} · ${range}`
}

/** Two taps: the first only asks, and goes back to asking after a few
 *  seconds - a note is his own writing, and one stray tap must not lose it. */
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  return (
    <Button
      variant={armed ? 'blocked' : 'ghost'}
      size="small"
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? 'Tap again to delete' : 'Delete'}
    </Button>
  )
}
