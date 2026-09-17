// Cuts the silent parts out of a video, entirely on-device - nothing is
// uploaded anywhere. Built on mediabunny, which wraps the browser's own
// WebCodecs hardware decoder/encoder, so this is as fast as the phone can go
// and never touches the network.
//
// Two passes over the file: analyzeSilence() decodes just the audio to find
// where the pauses are (silenceMath.ts does that math), then cutSilence()
// decodes both tracks and re-encodes only the ranges worth keeping.

import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny'

import { BALANCED_SETTINGS, findSilentRanges, keepRanges, totalDuration, type Level, type Range } from './silenceMath'

export class SilenceCutError extends Error {}

/** True once this browser can actually decode and re-encode video and audio.
 *  Safari only gained AudioEncoder/AudioDecoder in Safari 26 (2026); older
 *  iOS builds can decode video but never finish this, so check honestly
 *  rather than let it fail midway through someone's clip. */
export async function isSilenceCutSupported(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return false
  const [video, audio] = await Promise.all([canEncodeVideo('avc'), canEncodeAudio('aac')])
  return video && audio
}

/** Loudness of one audio window, in dB, from its root-mean-square amplitude.
 *  Silence is -Infinity dB, which is always below any real threshold. */
function levelDb(rms: number): number {
  return rms <= 0 ? -Infinity : 20 * Math.log10(rms)
}

const ANALYSIS_WINDOW_SEC = 0.02 // 20ms, same grain ffmpeg's silencedetect uses by default

/** Decodes the audio track and returns a loudness curve for silenceMath to read. */
async function measureLevels(audioTrack: NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>): Promise<Level[]> {
  const sink = new AudioBufferSink(audioTrack)
  const levels: Level[] = []

  for await (const { buffer, timestamp } of sink.buffers()) {
    const channel = buffer.getChannelData(0) // any one channel is enough to judge loudness
    const windowFrames = Math.max(1, Math.round(ANALYSIS_WINDOW_SEC * buffer.sampleRate))
    for (let i = 0; i < channel.length; i += windowFrames) {
      let sumSquares = 0
      const end = Math.min(i + windowFrames, channel.length)
      for (let j = i; j < end; j++) sumSquares += channel[j] * channel[j]
      const rms = Math.sqrt(sumSquares / (end - i))
      levels.push({ time: timestamp + i / buffer.sampleRate, db: levelDb(rms) })
    }
  }
  return levels
}

export interface SilenceCutResult {
  blob: Blob
  originalDurationSec: number
  newDurationSec: number
  /** Number of pauses removed. */
  cuts: number
}

/** Finds the ranges of this video worth keeping - i.e. the file with its
 *  pauses cut out, before anything is actually re-encoded. Call this first so
 *  the UI can show "12s of dead air found" before committing to the slower
 *  cut pass. */
export async function planCut(
  file: Blob,
  settings = BALANCED_SETTINGS,
): Promise<{ keep: Range[]; duration: number; silences: number }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const [duration, audioTrack] = await Promise.all([input.computeDuration(), input.getPrimaryAudioTrack()])
    if (!audioTrack) {
      throw new SilenceCutError('This video has no sound, so there is nothing to detect silence from.')
    }
    const levels = await measureLevels(audioTrack)
    const silences = findSilentRanges(levels, settings)
    const keep = keepRanges(silences, duration, settings.paddingSec)
    if (keep.length === 0) {
      throw new SilenceCutError('The whole video looks silent. Try recording somewhere quieter.')
    }
    return { keep, duration, silences: silences.length }
  } finally {
    input.dispose()
  }
}

/** Re-encodes `file`, keeping only the given ranges, and returns the cut
 *  video as an MP4 blob. `onProgress` is called with a 0-1 fraction. */
export async function cutSilence(
  file: Blob,
  keep: Range[],
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError(
      "This browser can't cut video yet. Update to the newest iOS/Safari, or use the Mac version.",
    )
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })

  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ])
    if (!videoTrack) throw new SilenceCutError('No video track found in this file.')
    if (!audioTrack) throw new SilenceCutError('This video has no sound, so there is nothing to detect silence from.')

    const rotation = await videoTrack.getRotation()
    const videoSource = new VideoSampleSource({ codec: 'avc', quality: QUALITY_HIGH })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource, { rotation })
    output.addAudioTrack(audioSource)
    await output.start()

    const videoSink = new VideoSampleSink(videoTrack)
    const audioSink = new AudioSampleSink(audioTrack)

    const total = totalDuration(keep)
    let doneSoFar = 0
    // Output timeline position, in seconds. Anchored independently per track
    // per range (see below) rather than to the range's nominal boundaries,
    // so a few milliseconds of audio/video misalignment at one cut can never
    // carry over and stack up by the next one.
    let cursor = 0

    for (const { start, end } of keep) {
      // Video and audio frames rarely land exactly on `start` - a decoder
      // only hands back whole frames, and an AAC frame's ~21ms grid has
      // nothing to do with where a silence happened to get cut. Each track
      // is shifted so *its own* first frame in this range starts exactly at
      // `cursor`, instead of both sharing one shift computed from `start`.
      // Sharing one shift was the bug: any gap between the tracks' true
      // first-sample timestamps became a permanent, compounding offset.
      let videoShift: number | null = null
      let audioShift: number | null = null
      let videoEnd = cursor
      let audioEnd = cursor

      await Promise.all([
        (async () => {
          for await (const sample of videoSink.samples(start, end)) {
            videoShift ??= cursor - sample.timestamp
            sample.setTimestamp(sample.timestamp + videoShift)
            videoEnd = sample.timestamp + sample.duration
            await videoSource.add(sample)
            sample.close()
          }
        })(),
        (async () => {
          for await (const sample of audioSink.samples(start, end)) {
            audioShift ??= cursor - sample.timestamp
            sample.setTimestamp(sample.timestamp + audioShift)
            audioEnd = sample.timestamp + sample.duration
            await audioSource.add(sample)
            sample.close()
          }
        })(),
      ])
      // The next range starts after whichever track actually ran longer -
      // never behind either one, so the two tracks can't overlap.
      cursor = Math.max(videoEnd, audioEnd)
      doneSoFar += end - start
      onProgress?.(Math.min(0.99, doneSoFar / total))
    }

    await output.finalize()
    onProgress?.(1)
    const buffer = output.target.buffer
    if (!buffer) throw new SilenceCutError('Rendering finished but produced no file. Try again.')
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    input.dispose()
  }
}

/** The whole job in one call: plan, then cut. Kept separate above so a UI
 *  that wants to show the plan before committing to the slow pass still can. */
export async function cutSilenceFromFile(
  file: Blob,
  onProgress?: (fraction: number) => void,
  settings = BALANCED_SETTINGS,
): Promise<SilenceCutResult> {
  const { keep, duration, silences } = await planCut(file, settings)
  const blob = await cutSilence(file, keep, onProgress)
  return { blob, originalDurationSec: duration, newDurationSec: totalDuration(keep), cuts: silences }
}
