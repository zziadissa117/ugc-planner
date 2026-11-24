// One notes section on IDEATE - "Notes from Ziad" or "Your notes" - and the
// same section on the coach screen, where the editable one is the other one.
//
// A section is editable only when it is handed `onSave`: the student writes
// their own notes (ideate_notes, saved on the device first and synced after),
// the coach writes his (coach_notes, through the coach function). Each reads
// the other's.
//
// A note can be about one video. The coach's note keeps the video's link
// (post_id, post_url), so it can open it again; a student's own note has
// nowhere to keep one, so the video is named in the words instead.

import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react'

import { dayLabel, instant, localDay } from '../data/ideate'
import { CloseIcon } from './icons'
import { INPUT_CLASS } from './styles'
import { Button, Card, SectionLabel } from './ui'

/** A note as either section shows it. */
export interface ShownNote {
  id: string
  body: string
  createdAt: string
  weekStart: string | null
  accountId: string | null
  postId: string | null
  postUrl: string | null
}

/** What a save hands back to whoever stores the note. */
export interface NoteDraft {
  /** Set when editing a saved note. */
  id?: string
  body: string
  weekStart: string | null
  accountId: string | null
  postId: string | null
  postUrl: string | null
}

/** The video a note is about. */
export interface NoteAbout {
  postId: string
  postUrl: string | null
  accountId: string
  weekStart: string | null
  /** "TikTok @handle, Mon, Nov 23" */
  label: string
}

export interface NotesHandle {
  /** Starts a note about one video and puts the cursor in it. */
  about(video: NoteAbout): void
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }

const SHOWN = 5
const length = (text: string) => Array.from(text).length
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function NotesSection({
  title,
  notes,
  onSave,
  onDelete,
  placeholder,
  empty,
  aboutAs,
  defaultWeekStart,
  maxLength,
  handle,
}: {
  title: string
  notes: readonly ShownNote[]
  /** Present when the viewer writes these notes. */
  onSave?: (draft: NoteDraft) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  placeholder?: string
  /** Shown when there are none and the viewer cannot write one. */
  empty: string
  /** How a note about one video remembers it: its link, or its name in the words. */
  aboutAs: 'link' | 'text'
  /** The Sunday a new note is filed under. */
  defaultWeekStart: string
  maxLength?: number
  handle?: Ref<NotesHandle>
}) {
  const titleId = useId()
  const editable = onSave !== undefined
  const area = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<ShownNote | null>(null)
  const [about, setAbout] = useState<NoteAbout | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [all, setAll] = useState(false)

  const body = draft.trim()
  const tooLong = maxLength !== undefined && length(body) > maxLength
  const busy = status.kind === 'saving'
  const canSave = body !== '' && !tooLong && !busy && (editing === null || body !== editing.body)

  // Focused at once, so typing straight after the tap lands in the box; the
  // cursor goes to the end once the new words are in it.
  const focus = () => {
    const el = area.current
    if (!el) return
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  useImperativeHandle(handle, () => ({
    about(video: NoteAbout) {
      setEditing(null)
      setAbout(video)
      setStatus({ kind: 'idle' })
      if (aboutAs === 'text') {
        const line = `${video.label}: `
        setDraft((d) => (d.trim() === '' || editing ? line : `${d.replace(/\s+$/, '')}\n${line}`))
      } else if (editing) {
        setDraft('')
      }
      focus()
    },
  }))

  function reset() {
    setDraft('')
    setEditing(null)
    setAbout(null)
  }

  async function save() {
    if (!onSave || !canSave) return
    setStatus({ kind: 'saving' })
    try {
      await onSave(
        editing
          ? {
              id: editing.id,
              body,
              weekStart: editing.weekStart,
              accountId: editing.accountId,
              postId: editing.postId,
              postUrl: editing.postUrl,
            }
          : {
              body,
              weekStart: about?.weekStart ?? defaultWeekStart,
              accountId: about?.accountId ?? null,
              postId: aboutAs === 'link' ? (about?.postId ?? null) : null,
              postUrl: aboutAs === 'link' ? (about?.postUrl ?? null) : null,
            },
      )
      reset()
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'error', message: describe(error) })
    }
  }

  async function remove(note: ShownNote) {
    if (!onDelete) return
    try {
      await onDelete(note.id)
      if (editing?.id === note.id) reset()
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'error', message: describe(error) })
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void save()
    }
  }

  const when = (note: ShownNote) => instant(note.createdAt) || 0
  const sorted = [...notes].sort((a, b) => when(b) - when(a) || a.id.localeCompare(b.id))
  const shown = all ? sorted : sorted.slice(0, SHOWN)

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <SectionLabel trailing={notes.length > 0 ? notes.length : null}>
        <span id={titleId}>{title}</span>
      </SectionLabel>

      <Card className="flex flex-col px-5">
        {editable ? (
          <div className={`flex flex-col gap-3 py-4 ${shown.length > 0 ? 'border-b border-rule' : ''}`}>
            {aboutAs === 'link' && about && !editing ? (
              <span className="meta flex items-center gap-2 self-start rounded-full border border-edge bg-white/[0.03] py-1 pl-3 pr-1 text-text-dim">
                <span className="min-w-0 truncate">{about.label}</span>
                <button
                  type="button"
                  aria-label="Not about this video"
                  onClick={() => setAbout(null)}
                  className="press flex size-7 shrink-0 items-center justify-center rounded-full text-state-later hover:bg-white/[0.06] hover:text-text"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
            <textarea
              ref={area}
              aria-label={title}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                if (status.kind === 'error') setStatus({ kind: 'idle' })
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={3}
              className={`${INPUT_CLASS} min-h-24 w-full resize-y py-3 text-base leading-relaxed`}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p aria-live="polite" className="meta min-w-0 flex-1">
                {status.kind === 'error' ? (
                  <span className="text-state-blocked">Not saved: {status.message}</span>
                ) : tooLong ? (
                  <span className="text-state-blocked">
                    Too long: {length(body).toLocaleString('en-US')} of {maxLength?.toLocaleString('en-US')} characters
                  </span>
                ) : null}
              </p>
              {editing || (draft !== '' && about) ? (
                <Button variant="ghost" size="small" onClick={reset} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
              <Button variant={canSave ? 'now' : 'quiet'} size="small" disabled={!canSave} onClick={() => void save()}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Save'}
              </Button>
            </div>
          </div>
        ) : null}

        {shown.length > 0 ? (
          <ul className="flex flex-col divide-y divide-rule">
            {shown.map((note) => (
              <li key={note.id} className={`flex flex-col gap-2 py-4 ${editing?.id === note.id ? 'opacity-50' : ''}`}>
                <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-text">{note.body}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="meta text-state-later">{dayLabel(localDay(note.createdAt))}</span>
                  {note.postUrl && /^https?:\/\//i.test(note.postUrl) ? (
                    <a
                      href={note.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="meta font-semibold text-brand underline-offset-4 hover:text-text hover:underline"
                    >
                      The video ↗
                    </a>
                  ) : null}
                  {editable ? (
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => {
                          setEditing(note)
                          setAbout(null)
                          setDraft(note.body)
                          setStatus({ kind: 'idle' })
                          focus()
                        }}
                      >
                        Edit
                      </Button>
                      {onDelete ? <DeleteButton onConfirm={() => void remove(note)} /> : null}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : !editable ? (
          <p className="py-5 text-base text-state-later">{empty}</p>
        ) : null}

        {sorted.length > SHOWN ? (
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            className="meta -mt-1 self-start pb-4 font-semibold text-state-later hover:text-text"
          >
            {all ? 'Show fewer' : `Show all ${sorted.length}`}
          </button>
        ) : null}
      </Card>
    </section>
  )
}

/** Two taps: the first only asks, and goes back to asking after a few
 *  seconds - a note is someone's own writing, and one stray tap must not
 *  lose it. */
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
