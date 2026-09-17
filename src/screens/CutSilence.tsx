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

type Settings = SilenceSettings & { preset: PresetName | 'custom' }

type Job = {
  id: string
  file: File
  settings: SilenceSettings
  status: 'queued' | 'working' | 'done' | 'failed'
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
  const [jobs, setJobs] = useState<Job[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const processing = useRef(false)

  useEffect(() => {
    let cancelled = false
    void isSilenceCutSupported().then((ok) => {
      if (!cancelled) setSupported(ok)
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
    setJobs((current) => current.map((j) => (j.id === next.id ? { ...j, status: 'working' } : j)))

    void (async () => {
      try {
        const result = await cutSilenceFromFile(
          next.file,
          (progress) => setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, progress } : j))),
          next.settings,
        )
        const url = URL.createObjectURL(result.blob)
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'done', result, url } : j)))
      } catch (err) {
        const message = err instanceof SilenceCutError ? err.message : 'Something went wrong cutting this video.'
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'failed', error: message } : j)))
      } finally {
        processing.current = false
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
        status: 'queued',
        progress: 0,
      }))
      setJobs((current) => [...current, ...added])
    },
    [settings],
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
              <p className="text-[11px] leading-relaxed text-state-later">
                Silence level: if words are getting cut, lower it (e.g. −45). If a noisy room isn't getting cut,
                raise it (e.g. −28). Changes apply to videos you add after changing them.
              </p>
            </div>
          </details>

          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={onFilesChosen}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex min-h-[6rem] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-edge bg-surface px-4 text-center active:bg-surface-raised"
          >
            <span className="text-lg font-semibold text-text">Add videos</span>
            <span className="text-sm text-state-later">As many as you want - each starts cutting right away</span>
          </button>

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
      <p className="text-[11px] uppercase tracking-[0.14em] text-state-later">{PRESET_HINT[settings.preset]}</p>
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
          <p className="text-[10px] uppercase tracking-[0.14em] text-state-later">
            Cutting… {Math.round(job.progress * 100)}%
          </p>
        </>
      ) : job.status === 'done' && job.result && job.url ? (
        <>
          <p className="text-sm text-state-posted">
            {formatTime(job.result.originalDurationSec)} → {formatTime(job.result.newDurationSec)} ·{' '}
            {job.result.cuts} pause{job.result.cuts === 1 ? '' : 's'} removed
          </p>
          {canShare && !shareFailed ? (
            <>
              <button
                type="button"
                onClick={() => void saveToPhotos()}
                className="flex min-h-tap items-center justify-center rounded-lg border border-state-now/70 bg-surface-raised text-sm font-semibold text-state-now active:bg-surface"
              >
                Save to Photos
              </button>
              <p className="text-[10px] text-state-later">
                Opens the share sheet - tap "Save Video" and it lands in Camera Roll, ready for CapCut.
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
