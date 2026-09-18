// Cutting the dead air out of a raw clip is optional and never gates
// anything - the same rule the rest of this app already holds for editing
// and posting. It's reached from a second button next to "Mark edited",
// never in place of it: tapping "Mark edited" alone still works exactly as
// it always did, no file required. This is only for whoever wants the
// browser to take a first pass at a batch of raw clips before finishing the
// cut themselves in CapCut.
//
// Same presets, same batch-queue shape as the desktop Silence Cutter tool:
// pick a pacing (or fine-tune it), then drop in as many videos as you want -
// each one starts cutting with whatever settings were selected the moment it
// was added, queued one at a time so a phone's decoder isn't asked to do two
// videos at once. Runs entirely on-device via WebCodecs (../media/silenceCut)
// - nothing is ever uploaded.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isFillerWordDetectionSupported } from '../media/fillerWords'
import { forgetJob, loadPendingJobs, persistJob } from '../media/jobStore'
import { PRESETS, type PresetName, type SilenceSettings } from '../media/silenceMath'
import { SilenceCutError, cutSilenceFromFile, isSilenceCutSupported, type SilenceCutResult } from '../media/silenceCut'

const PRESET_ORDER: PresetName[] = ['natural', 'balanced', 'tight']
const PRESET_LABEL: Record<PresetName, string> = { natural: 'Natural', balanced: 'Balanced', tight: 'Tight' }
const PRESET_HINT: Record<PresetName | 'custom', string> = {
  natural: 'Relaxed. Keeps short pauses so it sounds conversational.',
  balanced: 'The default. Removes awkward pauses, keeps a natural rhythm.',
  tight: 'Fast pacing. Cuts almost every pause.',
  custom: 'Custom settings.',
}

const PHASE_LABEL: Record<Job['phase'], string> = {
  downloading: 'Downloading the filler-word model',
  transcribing: 'Listening for filler words',
  cutting: 'Cutting',
}

type Settings = SilenceSettings & { preset: PresetName | 'custom' }

type Job = {
  id: string
  file: File
  settings: SilenceSettings
  detectFillerWords: boolean
  status: 'queued' | 'working' | 'done' | 'failed'
  /** Which stage "working" is in - only ever more than "cutting" when this
   *  job asked for filler-word detection. */
  phase: 'downloading' | 'transcribing' | 'cutting'
  progress: number
  result?: SilenceCutResult
  url?: string
  error?: string
}

function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** `original.mov` -> `original_cut.mp4`. Always .mp4: that's what the cutter writes. */
function cutName(originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, '')
  return `${base || 'video'}_cut.mp4`
}

/** True when this browser can hand a video file to the OS share sheet - on
 *  iOS that sheet has a one-tap "Save Video" that writes straight to Camera
 *  Roll, which is what makes it show up for CapCut to import like anything
 *  he filmed. No browser can write to Photos with zero taps at all - that
 *  would be a website silently dropping files into your photo library,
 *  which every browser blocks on purpose. This is the closest real path. */
function canShareVideo(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([], 'test.mp4', { type: 'video/mp4' })] })
  } catch {
    return false
  }
}

let nextId = 0

export function CutSilence({ onBack }: { onBack: () => void }) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<Settings>({ ...PRESETS.balanced, preset: 'balanced' })
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [detectFillerWords, setDetectFillerWords] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [restoredCount, setRestoredCount] = useState(0)
  const [justAdded, setJustAdded] = useState<{ count: number; at: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const processing = useRef(false)
  const fillerWordsSupported = useMemo(() => isFillerWordDetectionSupported(), [])

  useEffect(() => {
    let cancelled = false
    void isSilenceCutSupported().then((ok) => {
      if (!cancelled) setSupported(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A video he already added should survive whatever happens to the tab
  // before it gets processed - a background service-worker update, iOS
  // reclaiming memory while its own picker is busy with several large
  // videos, or just closing the tab by accident. Anything left over from
  // before this load is picked back up here, oldest first, rather than
  // silently gone. See jobStore.ts.
  useEffect(() => {
    let cancelled = false
    void loadPendingJobs().then((pending) => {
      if (cancelled || pending.length === 0) return
      setJobs((current) => [
        ...pending.map((p) => ({
          id: p.id,
          file: p.file,
          settings: p.settings,
          detectFillerWords: p.detectFillerWords,
          status: 'queued' as const,
          phase: 'cutting' as const,
          progress: 0,
        })),
        ...current,
      ])
      setRestoredCount(pending.length)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Revoke every result's object URL on unmount, so navigating away doesn't
  // leak memory for videos nobody downloaded.
  useEffect(
    () => () => {
      setJobs((current) => {
        for (const job of current) if (job.url) URL.revokeObjectURL(job.url)
        return current
      })
    },
    [],
  )

  // Fades on its own after a moment - it's a receipt for the tap that just
  // happened, not something to dismiss.
  useEffect(() => {
    if (!justAdded) return
    const timer = window.setTimeout(() => setJustAdded(null), 4000)
    return () => window.clearTimeout(timer)
  }, [justAdded])

  const applyPreset = useCallback((preset: PresetName) => setSettings({ ...PRESETS[preset], preset }), [])
  const applyCustom = useCallback(
    (patch: Partial<SilenceSettings>) => setSettings((s) => ({ ...s, ...patch, preset: 'custom' })),
    [],
  )

  // One job runs at a time - a phone's decoder/encoder is already working
  // hard on a single video; two at once would just make both slower and risk
  // running the browser tab out of memory. Driven by an effect that watches
  // the queue, rather than a callback that reaches back into itself, so
  // there's exactly one thing deciding "what runs next": the job list.
  useEffect(() => {
    if (processing.current) return
    const next = jobs.find((j) => j.status === 'queued')
    if (!next) return
    processing.current = true
    const setPhase = (phase: Job['phase'], progress: number) =>
      setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'working', phase, progress } : j)))
    setPhase(next.detectFillerWords ? 'downloading' : 'cutting', 0)

    void (async () => {
      try {
        const result = await cutSilenceFromFile(
          next.file,
          (progress) => setPhase('cutting', progress),
          next.settings,
          next.detectFillerWords
            ? {
                detectFillerWords: true,
                onModelDownload: (progress) => setPhase('downloading', progress),
                onTranscribeProgress: (progress) => setPhase('transcribing', progress),
              }
            : {},
        )
        const url = URL.createObjectURL(result.blob)
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'done', result, url } : j)))
      } catch (err) {
        const message = err instanceof SilenceCutError ? err.message : 'Something went wrong cutting this video.'
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'failed', error: message } : j)))
      } finally {
        processing.current = false
        // Only ever needs to survive a reload while it's still waiting or
        // running - once it's done or failed, this session already has the
        // result (or the reason), so there's nothing left to protect.
        void forgetJob(next.id)
      }
    })()
  }, [jobs])

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const { preset: _preset, ...snapshot } = settings
      const added: Job[] = Array.from(files).map((file) => ({
        id: String(nextId++),
        file,
        settings: snapshot,
        detectFillerWords: detectFillerWords && fillerWordsSupported,
        status: 'queued',
        phase: 'cutting',
        progress: 0,
      }))
      setJobs((current) => [...current, ...added])
      setJustAdded({ count: added.length, at: Date.now() })
      // Written to IndexedDB right away, not just kept in memory - see
      // jobStore.ts for why. A write that fails here (private browsing,
      // storage full) still leaves the video queued for this session; it
      // just wouldn't survive a reload, same as before this existed.
      for (const job of added) {
        void persistJob({
          id: job.id,
          fileBlob: job.file,
          fileName: job.file.name,
          fileType: job.file.type,
          settings: job.settings,
          detectFillerWords: job.detectFillerWords,
        }).catch(() => {
          // Nothing to do about it here - the job is already queued in
          // memory and will still run this session.
        })
      }
    },
    [detectFillerWords, fillerWordsSupported, settings],
  )

  const onFilesChosen = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files)
      e.target.value = '' // lets the same file(s) be picked again later
    },
    [addFiles],
  )

  const clearFinished = useCallback(() => {
    setJobs((current) => {
      for (const j of current) if ((j.status === 'done' || j.status === 'failed') && j.url) URL.revokeObjectURL(j.url)
      return current.filter((j) => j.status === 'queued' || j.status === 'working')
    })
  }, [])

  const summary = useMemo(() => {
    const total = jobs.length
    if (total === 0) return null
    const done = jobs.filter((j) => j.status === 'done').length
    const failed = jobs.filter((j) => j.status === 'failed').length
    const removedSec = jobs
      .filter((j) => j.result)
      .reduce((sum, j) => sum + (j.result!.originalDurationSec - j.result!.newDurationSec), 0)
    let text = `${done} of ${total} done`
    if (failed > 0) text += ` · ${failed} failed`
    if (removedSec > 0) text += ` · ${formatTime(removedSec)} of dead air removed`
    return text
  }, [jobs])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">Cut silence</h2>

      {supported === false ? (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-3">
          <p className="text-sm text-text">
            This browser can't cut video yet - it needs a newer version of iOS/Safari (26 or later), or Chrome.
          </p>
          <p className="text-sm text-state-later">
            The desktop Silence Cutter tool works today if you'd rather cut on a Mac.
          </p>
        </div>
      ) : (
        <>
          <PresetPicker settings={settings} onPreset={applyPreset} />

          <details
            className="rounded-lg border border-edge bg-surface px-3 py-2"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm text-state-later">Fine-tune</summary>
            <div className="mt-3 flex flex-col gap-3">
              <Slider
                label="Silence level"
                value={settings.thresholdDb}
                min={-60}
                max={-20}
                step={1}
                format={(v) => `${v} dB`}
                onChange={(v) => applyCustom({ thresholdDb: v })}
              />
              <Slider
                label="Shortest pause to cut"
                value={settings.minSilenceSec}
                min={0.1}
                max={2}
                step={0.05}
                format={(v) => `${v.toFixed(2)} s`}
                onChange={(v) => applyCustom({ minSilenceSec: v })}
              />
              <Slider
                label="Breathing room"
                value={settings.paddingSec}
                min={0}
                max={0.4}
                step={0.01}
                format={(v) => `${v.toFixed(2)} s`}
                onChange={(v) => applyCustom({ paddingSec: v })}
              />
              <p className="meta leading-relaxed text-state-later">
                Silence level: if words are getting cut, lower it (e.g. −45). If a noisy room isn't getting cut,
                raise it (e.g. −28). Changes apply to videos you add after changing them.
              </p>
            </div>
          </details>

          {fillerWordsSupported ? (
            <label className="flex items-start gap-3 rounded-lg border border-edge bg-surface px-3 py-3">
              <input
                type="checkbox"
                checked={detectFillerWords}
                onChange={(e) => setDetectFillerWords(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-state-now"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-text">Also cut "um" and "uh"</span>
                <span className="meta leading-relaxed text-state-later">
                  Listens to every word (on-device, English only) and cuts spoken filler words the same way a
                  pause gets cut. Doesn't catch coughs or laughs - those aren't words, so nothing that listens for
                  words can find them. Downloads a small model the first time, and each video takes noticeably
                  longer with this on.
                </span>
              </span>
            </label>
          ) : null}

          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={onFilesChosen}
          />
          {restoredCount > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-state-waiting/40 bg-state-waiting/10 px-3 py-2">
              <p className="text-sm text-text">
                Picked back up {restoredCount} video{restoredCount === 1 ? '' : 's'} that hadn't finished - a
                video you add is saved right away now, so a reload can't lose it.
              </p>
              <button
                type="button"
                onClick={() => setRestoredCount(0)}
                aria-label="Dismiss"
                className="shrink-0 rounded px-1 text-state-later active:bg-surface-raised"
              >
                ✕
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex min-h-[6rem] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-edge bg-surface px-4 text-center active:bg-surface-raised"
          >
            <span className="text-lg font-semibold text-text">Add videos</span>
            <span className="text-sm text-state-later">As many as you want - each starts cutting right away</span>
          </button>

          {justAdded ? (
            <p key={justAdded.at} className="rise-in text-center text-sm text-state-posted">
              Added {justAdded.count} video{justAdded.count === 1 ? '' : 's'} to the queue
              {justAdded.count > 1 ? ' - check that is everything you picked.' : '.'}
            </p>
          ) : null}

          {jobs.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-state-later">{summary}</p>
                <button
                  type="button"
                  onClick={clearFinished}
                  className="min-h-tap rounded-md border border-edge bg-surface px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
                >
                  Clear finished
                </button>
              </div>
              <ul className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
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

function PresetPicker({ settings, onPreset }: { settings: Settings; onPreset: (p: PresetName) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-3">
      <p className="label text-state-later">{PRESET_HINT[settings.preset]}</p>
      <div className="flex gap-1.5">
        {PRESET_ORDER.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onPreset(preset)}
            className={[
              'min-h-tap flex-1 rounded-md text-sm font-semibold transition-colors',
              settings.preset === preset
                ? 'border border-state-now/70 bg-surface-raised text-state-now'
                : 'border border-edge bg-ink text-state-later active:bg-surface-raised',
            ].join(' ')}
          >
            {PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text">{label}</span>
        <span className="numeric text-state-later">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-state-now"
      />
    </label>
  )
}

function JobCard({ job }: { job: Job }) {
  const [shareFailed, setShareFailed] = useState(false)
  const canShare = useMemo(() => canShareVideo(), [])

  const saveToPhotos = useCallback(async () => {
    if (!job.result) return
    const file = new File([job.result.blob], cutName(job.file.name), { type: 'video/mp4' })
    try {
      await navigator.share({ files: [file] })
    } catch (err) {
      // AbortError just means he closed the share sheet without picking
      // anything - not a failure, nothing to show for it.
      if (err instanceof Error && err.name === 'AbortError') return
      setShareFailed(true)
    }
  }, [job.file.name, job.result])

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
      <p className="truncate text-sm text-text">{job.file.name}</p>

      {job.status === 'queued' ? (
        <p className="text-sm text-state-later">Waiting in line…</p>
      ) : job.status === 'working' ? (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink">
            <div
              className="h-full rounded-full bg-state-now transition-[width] duration-300"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
          <p className="label text-state-later">
            {PHASE_LABEL[job.phase]}… {Math.round(job.progress * 100)}%
          </p>
        </>
      ) : job.status === 'done' && job.result && job.url ? (
        <>
          <p className="text-sm text-state-posted">
            {formatTime(job.result.originalDurationSec)} → {formatTime(job.result.newDurationSec)} ·{' '}
            {job.result.cuts} pause{job.result.cuts === 1 ? '' : 's'} removed
            {job.result.fillerWords != null
              ? ` · ${job.result.fillerWords} filler word${job.result.fillerWords === 1 ? '' : 's'} removed`
              : ''}
          </p>
          {canShare && !shareFailed ? (
            <>
              <button
                type="button"
                onClick={() => void saveToPhotos()}
                className="flex min-h-tap items-center justify-center rounded-lg border border-state-now/70 bg-surface-raised text-sm font-semibold text-state-now active:bg-surface"
              >
                Save or send
              </button>
              <p className="meta text-state-later">
                Opens the share sheet. If CapCut is listed there, tap it to send the video straight in - otherwise
                tap "Save Video" and it lands in Camera Roll, ready to import.
              </p>
            </>
          ) : (
            <a
              href={job.url}
              download={cutName(job.file.name)}
              className="flex min-h-tap items-center justify-center rounded-lg border border-state-now/70 bg-surface-raised text-sm font-semibold text-state-now active:bg-surface"
            >
              Save {cutName(job.file.name)}
            </a>
          )}
        </>
      ) : (
        <p className="text-sm text-state-blocked">{job.error}</p>
      )}
    </div>
  )
}
