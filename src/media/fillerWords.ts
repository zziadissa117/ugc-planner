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

import type { Range } from './silenceMath'

/** Whisper's feature extractor is trained on 16kHz audio and expects the
 *  input already at that rate - a raw Float32Array is passed straight
 *  through with no resampling of its own. */
export const WHISPER_SAMPLE_RATE = 16000

const MODEL_ID = 'Xenova/whisper-tiny.en'

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

/** The ranges to cut for spoken filler words, padded the same way a silent
 *  pause is so the words around it don't get clipped. */
export function fillerWordRanges(chunks: WordChunk[], paddingSec: number): Range[] {
  return chunks
    .filter((c) => FILLER_WORDS.has(normalize(c.text)))
    .map((c) => ({ start: Math.max(0, c.start - paddingSec), end: c.end + paddingSec }))
}
