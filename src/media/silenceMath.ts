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

/** The quietest moment within `windowSec` either side of `time`, or null if
 *  the level curve does not reach that far. */
function quietestNear(levels: Level[], time: number, windowSec: number): Level | null {
  let best: Level | null = null
  for (const level of levels) {
    if (level.time < time - windowSec) continue
    if (level.time > time + windowSec) break
    if (!best || level.db < best.db) best = level
  }
  return best
}

/** Pulls a roughly-placed cut onto the nearest genuine gap in the audio, and
 *  refuses the cut outright when there is no gap to land on.
 *
 *  This exists because a speech recogniser's word timings are approximate -
 *  good to about a fifth of a second - while a cut is exact. Trusting those
 *  timings directly is what turned "I really want to master that" into "I
 *  really want to mas", and "connections" into "connec": the reported end of
 *  an "um" sat a little late, inside the word after it, and the cut went
 *  where it was told.
 *
 *  The loudness curve already knows where the speech actually stops, so each
 *  end of the cut is moved to the quietest instant nearby. If neither end has
 *  a quiet instant to move to - the filler is said straight into the next
 *  word, with no gap at all - this returns null and the filler is left in.
 *  Leaving an "um" in costs him a second with the trimmer; taking a syllable
 *  off a word he needs costs him the take. */
export function snapCutToQuiet(
  range: Range,
  levels: Level[],
  { windowSec, quietBelowDb }: { windowSec: number; quietBelowDb: number },
): Range | null {
  const start = quietestNear(levels, range.start, windowSec)
  const end = quietestNear(levels, range.end, windowSec)
  if (!start || !end) return null
  // Both ends have to land somewhere actually quiet. If they don't, this is
  // speech all the way through and nothing here is safe to remove.
  if (start.db > quietBelowDb || end.db > quietBelowDb) return null
  if (end.time - start.time < 0.05) return null
  return { start: start.time, end: end.time }
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
