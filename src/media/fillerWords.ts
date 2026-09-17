// Detects spoken filler words ("um", "uh"...) so they can be cut the same
// way a silent pause is. Runs Whisper entirely on-device via transformers.js
// - the audio never leaves the phone, same as the rest of this tool.
//
// This does NOT catch coughs, laughs or other non-speech noise. Whisper
// transcribes words; a cough isn't one. Catching non-speech sound reliably
// needs a different kind of model (audio event classification, not speech
// recognition), which is a real gap, not an oversight - see CutSilence.tsx
// for how that's explained to him rather than silently pretending it works.

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

/** Mirrors the library's own (unexported) `Chunk` shape. */
interface TimestampedChunk {
  text: string
  timestamp: [number, number]
}

import type { Level, Range } from './silenceMath'

/** Whisper's feature extractor is trained on 16kHz audio and expects the
 *  input already at that rate - a raw Float32Array is passed straight
 *  through with no resampling of its own. */
export const WHISPER_SAMPLE_RATE = 16000

/** base.en rather than tiny.en. tiny is half the download and noticeably
 *  faster, and its word timings are not good enough to cut on: on a real take
 *  it reported an "um" as lasting 20 milliseconds and put it 300ms from where
 *  it actually was, which is how a cut ended up inside the word after it. On
 *  the same clip base.en found all three fillers where tiny found one, and
 *  timed them to within a frame or two. The extra ~35MB buys the difference
 *  between a feature that works and one that damages takes. */
const MODEL_ID = 'Xenova/whisper-base.en'

/** English fillers, lowercased, punctuation stripped. Whisper sometimes
 *  spells these a few different ways ("umm" vs "um"), so this is a small set
 *  rather than one exact string. */
const FILLER_WORDS = new Set([
  'um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'er', 'err', 'erm', 'hmm', 'hmmm', 'mhm',
])

export interface WordChunk {
  text: string
  start: number
  end: number
}

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null

/** Loaded once per browser tab and cached by transformers.js itself between
 *  page loads (it keeps the downloaded model in the browser's own Cache
 *  Storage), so this is only ever a real download the first time it runs. */
function getTranscriber(onModelProgress?: (fraction: number) => void) {
  transcriber ??= pipeline('automatic-speech-recognition', MODEL_ID, {
    progress_callback: (data: { status: string; progress?: number }) => {
      if (onModelProgress && data.status === 'progress' && typeof data.progress === 'number') {
        onModelProgress(data.progress / 100)
      }
    },
  })
  return transcriber
}

/** Starts (or waits for) the model load, reporting download progress. A
 *  separate step from transcribeWithWordTimestamps because the download only
 *  ever happens once per tab and the caller wants to show it as its own
 *  phase ("Downloading the filler-word model…") rather than folded into the
 *  transcribing progress bar. */
export async function getTranscriberReady(onDownloadProgress?: (fraction: number) => void): Promise<void> {
  await getTranscriber(onDownloadProgress)
}

/** True once this browser can actually run the model - same WebAssembly
 *  requirement transformers.js has everywhere, which is effectively "any
 *  browser released in the last several years." */
export function isFillerWordDetectionSupported(): boolean {
  return typeof WebAssembly !== 'undefined'
}

/** Mixes an AudioBuffer down to mono and resamples it to 16kHz via linear
 *  interpolation. Good enough for speech recognition - this isn't trying to
 *  preserve audio fidelity, just get words in the right place. */
export function resampleToMono16k(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const mono = new Float32Array(buffer.length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels
  }
  if (buffer.sampleRate === WHISPER_SAMPLE_RATE) return mono

  const ratio = buffer.sampleRate / WHISPER_SAMPLE_RATE
  const outLength = Math.max(1, Math.round(mono.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio
    const i0 = Math.floor(srcIndex)
    const i1 = Math.min(i0 + 1, mono.length - 1)
    const frac = srcIndex - i0
    out[i] = mono[i0] * (1 - frac) + mono[Math.min(i1, mono.length - 1)] * frac
  }
  return out
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Transcribes the whole track and returns every word with its timing.
 *  `chunk_length_s`/`stride_length_s` is transformers.js's documented way of
 *  handling audio longer than Whisper's native 30-second window - not the
 *  streaming-callback API, which has open bugs around word timestamps
 *  returning null. This calls the pipeline directly on the full buffer. */
export async function transcribeWithWordTimestamps(
  samples: Float32Array,
  onProgress?: (fraction: number) => void,
): Promise<WordChunk[]> {
  const model = await getTranscriber()
  const result = await model(samples, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
  })
  onProgress?.(1)
  const output = Array.isArray(result) ? result[0] : result
  const chunks: TimestampedChunk[] = output.chunks ?? []
  return chunks
    .filter((c) => c.timestamp[0] != null && c.timestamp[1] != null)
    .map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] }))
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '')
}

/** The ranges to cut for spoken filler words.
 *
 *  The recogniser's timings are approximate, so a filler's own start and end
 *  are not trustworthy enough to cut on directly. What *is* trustworthy is
 *  which words it heard either side: a cut for an "um" must never reach past
 *  the real word before it or the real word after it. Those two words are the
 *  guard rails, and `guardSec` keeps the cut a little clear of both.
 *
 *  Inside that corridor the cut is opened out to the quietest instant it can
 *  find, so the "um" goes along with the dead air around it and what is left
 *  runs speech straight into speech. Where the corridor is too tight to hold
 *  a cut at all - a filler said right on top of the next word - nothing is
 *  removed. An "um" left in costs a second with the trimmer. A syllable taken
 *  off "connections" costs the take. */
export function fillerWordRanges(
  chunks: WordChunk[],
  levels: Level[],
  { guardSec }: { guardSec: number } = { guardSec: 0.04 },
): Range[] {
  const isFiller = (c: WordChunk) => FILLER_WORDS.has(normalize(c.text))
  const ranges: Range[] = []

  chunks.forEach((chunk, i) => {
    if (!isFiller(chunk)) return

    // The nearest real words either side - not other fillers, so a run of
    // "um, uh" collapses into one cut rather than fighting over the gap.
    let low = 0
    for (let j = i - 1; j >= 0; j--) {
      if (!isFiller(chunks[j])) {
        low = chunks[j].end + guardSec
        break
      }
    }
    let high = Number.POSITIVE_INFINITY
    for (let j = i + 1; j < chunks.length; j++) {
      if (!isFiller(chunks[j])) {
        high = chunks[j].start - guardSec
        break
      }
    }

    const start = Math.max(low, Math.min(chunk.start, high))
    const end = Math.min(high, Math.max(chunk.end, low))
    if (!(end > start) || end - start < 0.05) return

    // Widen to the quietest moment on each side, but never outside the
    // corridor the neighbouring words define.
    ranges.push({
      start: quietestBetween(levels, low, start, 'earliest') ?? start,
      end: quietestBetween(levels, end, high, 'latest') ?? end,
    })
  })

  return ranges
}

/** The time of the quietest level in [from, to], or null when the curve has
 *  nothing in that span.
 *
 *  A gap is usually flat silence, so most of it ties for quietest. Which end
 *  of that tie wins decides whether the cut opens out into the gap or stops
 *  at its edge: the start of a cut wants the earliest such moment and the end
 *  of one wants the latest, so between them they take the whole pause and
 *  leave speech running into speech. */
function quietestBetween(
  levels: Level[],
  from: number,
  to: number,
  tie: 'earliest' | 'latest',
): number | null {
  let best: Level | null = null
  for (const level of levels) {
    if (level.time < from) continue
    if (level.time > to) break
    if (!best || level.db < best.db || (tie === 'latest' && level.db === best.db)) best = level
  }
  return best ? best.time : null
}
