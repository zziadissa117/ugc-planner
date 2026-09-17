// Pure silence-detection math, with no browser or codec dependency so it can
// be unit-tested under jsdom like the rest of the data layer. The actual
// decoding lives in silenceCut.ts, which feeds this module a level curve.
//
// Same algorithm as the desktop Silence Cutter tool (ffmpeg's silencedetect
// plus a padding pass): find runs where the level stays under a dB threshold
// for at least `minSilenceSec`, then invert those runs into the ranges to
// keep, leaving `paddingSec` of breathing room around each cut so words don't
// get clipped.

/** One sample of the audio's loudness, in dB, at a point in time. */
export interface Level {
  time: number
  db: number
}

export interface Range {
  start: number
  end: number
}

export interface SilenceSettings {
  /** Below this loudness (in dB) counts as silence. -35 is a reasonable room. */
  thresholdDb: number
  /** A quiet stretch shorter than this is left alone, so speech still breathes. */
  minSilenceSec: number
  /** Kept around every cut, so a word's first or last sound never gets clipped. */
  paddingSec: number
}

/** Same three presets as the desktop Silence Cutter tool, same numbers, so a
 *  clip cut on the phone and one cut on the Mac land the same way. */
export const PRESETS = {
  natural: { thresholdDb: -35, minSilenceSec: 0.6, paddingSec: 0.18 },
  balanced: { thresholdDb: -35, minSilenceSec: 0.4, paddingSec: 0.12 },
  tight: { thresholdDb: -35, minSilenceSec: 0.25, paddingSec: 0.07 },
} as const satisfies Record<string, SilenceSettings>

export type PresetName = keyof typeof PRESETS

export const BALANCED_SETTINGS: SilenceSettings = PRESETS.balanced

/** Runs of consecutive `db < thresholdDb` levels lasting at least `minSilenceSec`. */
export function findSilentRanges(levels: Level[], settings: SilenceSettings): Range[] {
  const ranges: Range[] = []
  let runStart: number | null = null
  let last: Level | null = null

  for (const level of levels) {
    const quiet = level.db < settings.thresholdDb
    if (quiet && runStart === null) {
      runStart = level.time
    } else if (!quiet && runStart !== null) {
      if (last && last.time - runStart >= settings.minSilenceSec) {
        ranges.push({ start: runStart, end: level.time })
      }
      runStart = null
    }
    last = level
  }
  if (runStart !== null && last && last.time - runStart >= settings.minSilenceSec) {
    // Silence ran to the end of the file with no loud level to close it.
    ranges.push({ start: runStart, end: last.time })
  }
  return ranges
}

/** The smallest section worth keeping - shorter blips (a click, a breath) are dropped. */
const MIN_KEEP_SEC = 0.1

/** Turns silent ranges into the ranges to keep: everything else, padded so
 *  the cut lands just outside the speech rather than on top of it. */
export function keepRanges(silences: Range[], duration: number, paddingSec: number): Range[] {
  const keeps: Range[] = []
  let cursor = 0

  for (const { start, end } of silences) {
    // Silence touching the very start or end of the file is cut flush - no
    // word can be there to protect with padding.
    const cutStart = start <= 0.01 ? 0 : start + paddingSec
    const cutEnd = end >= duration - 0.01 ? duration : end - paddingSec
    if (cutEnd - cutStart <= 0.01) continue
    if (cutStart > cursor) keeps.push({ start: cursor, end: cutStart })
    cursor = Math.max(cursor, cutEnd)
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration })

  return keeps.filter((r) => r.end - r.start >= MIN_KEEP_SEC)
}

/** Sorts and collapses overlapping/touching ranges into one, so a list built
 *  from two different sources (silence, spoken filler words) can be fed to
 *  keepRanges as a single well-ordered set - it walks the list assuming each
 *  range starts no earlier than the one before it. */
export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = [{ ...sorted[0] }]
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function totalDuration(ranges: Range[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
}
