// Cutting the dead air out of a raw clip is optional and never gates
// anything - the same rule the rest of this app already holds for editing
// and posting. It's reached from a second button next to "Mark edited",
// never in place of it: tapping "Mark edited" alone still works exactly as
// it always did, no file required. This is only for whoever wants the
// browser to take a first pass before they finish the cut themselves in
// CapCut.
//
// Runs entirely on-device via WebCodecs (see ../media/silenceCut.ts) - the
// video is never uploaded anywhere.

import { useCallback, useEffect, useRef, useState } from 'react'

import { SilenceCutError, cutSilenceFromFile, isSilenceCutSupported, type SilenceCutResult } from '../media/silenceCut'

type State =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'idle' }
  | { kind: 'working'; name: string; progress: number }
  | { kind: 'done'; name: string; result: SilenceCutResult; url: string }
  | { kind: 'failed'; name: string; message: string }

function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** `original.mov` -> `original_cut.mp4`. Always .mp4: that's what the cutter writes. */
function cutName(originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, '')
  return `${base || 'video'}_cut.mp4`
}

export function CutSilence({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const fileInput = useRef<HTMLInputElement>(null)
  // Revoke the previous object URL whenever a new one replaces it, or on
  // unmount, so a long session doesn't leak memory one video at a time.
  const urlToRelease = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void isSilenceCutSupported().then((supported) => {
      if (!cancelled) setState(supported ? { kind: 'idle' } : { kind: 'unsupported' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      if (urlToRelease.current) URL.revokeObjectURL(urlToRelease.current)
    },
    [],
  )

  const runCut = useCallback(async (file: File) => {
    setState({ kind: 'working', name: file.name, progress: 0 })
    try {
      const result = await cutSilenceFromFile(file, (progress) =>
        setState((s) => (s.kind === 'working' ? { ...s, progress } : s)),
      )
      if (urlToRelease.current) URL.revokeObjectURL(urlToRelease.current)
      const url = URL.createObjectURL(result.blob)
      urlToRelease.current = url
      setState({ kind: 'done', name: file.name, result, url })
    } catch (err) {
      const message = err instanceof SilenceCutError ? err.message : 'Something went wrong cutting this video.'
      setState({ kind: 'failed', name: file.name, message })
    }
  }, [])

  const pick = useCallback(() => fileInput.current?.click(), [])

  const onFileChosen = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // lets the same file be picked again after a retry
      if (file) void runCut(file)
    },
    [runCut],
  )

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">Cut silence</h2>

      <input ref={fileInput} type="file" accept="video/*" className="hidden" onChange={onFileChosen} />

      {state.kind === 'checking' ? (
        <p className="text-sm text-state-later">Checking this browser…</p>
      ) : state.kind === 'unsupported' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-3">
          <p className="text-sm text-text">
            This browser can't cut video yet - it needs a newer version of iOS/Safari (26 or later), or Chrome.
          </p>
          <p className="text-sm text-state-later">
            The desktop Silence Cutter tool works today if you'd rather cut on a Mac.
          </p>
        </div>
      ) : state.kind === 'idle' ? (
        <button
          type="button"
          onClick={pick}
          className="flex min-h-[7rem] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-edge bg-surface px-4 text-center active:bg-surface-raised"
        >
          <span className="text-lg font-semibold text-text">Choose a video</span>
          <span className="text-sm text-state-later">Cuts the pauses out, right here on your phone</span>
        </button>
      ) : state.kind === 'working' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-3">
          <p className="truncate text-sm text-text">{state.name}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink">
            <div
              className="h-full rounded-full bg-state-now transition-[width] duration-300"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-state-later">
            Cutting… {Math.round(state.progress * 100)}%
          </p>
        </div>
      ) : state.kind === 'done' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-3">
          <p className="truncate text-sm text-text">{state.name}</p>
          <p className="text-sm text-state-posted">
            {formatTime(state.result.originalDurationSec)} → {formatTime(state.result.newDurationSec)} ·{' '}
            {state.result.cuts} pause{state.result.cuts === 1 ? '' : 's'} removed
          </p>
          <a
            href={state.url}
            download={cutName(state.name)}
            className="flex min-h-tap items-center justify-center rounded-lg border border-state-now/70 bg-surface-raised text-sm font-semibold text-state-now active:bg-surface"
          >
            Save {cutName(state.name)}
          </a>
          <p className="text-[10px] text-state-later">
            Saved to your downloads - open it from there in CapCut to finish the edit.
          </p>
          <button
            type="button"
            onClick={() => setState({ kind: 'idle' })}
            className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
          >
            Cut another
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-3">
          <p className="truncate text-sm text-text">{state.name}</p>
          <p className="text-sm text-state-blocked">{state.message}</p>
          <button
            type="button"
            onClick={() => setState({ kind: 'idle' })}
            className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
          >
            Try again
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-state-later active:bg-surface-raised"
      >
        Back
      </button>
    </div>
  )
}
