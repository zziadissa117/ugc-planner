import { describe, expect, it } from 'vitest'

import {
  elapsedMs,
  emptyDay,
  forDate,
  formatElapsed,
  isRunning,
  pause,
  reset,
  start,
} from './workClock'

const DAY = '2026-09-09'
const NOON = new Date(2026, 8, 9, 12, 0, 0).getTime()

describe('the work clock', () => {
  it('starts at nothing and is not running', () => {
    const day = emptyDay(DAY)
    expect(elapsedMs(day, NOON)).toBe(0)
    expect(isRunning(day)).toBe(false)
  })

  it('counts while it runs', () => {
    const day = start(emptyDay(DAY), new Date(NOON))
    expect(isRunning(day)).toBe(true)
    expect(elapsedMs(day, NOON + 90_000)).toBe(90_000)
  })

  it('banks the stretch when paused, and keeps it', () => {
    const running = start(emptyDay(DAY), new Date(NOON))
    const paused = pause(running, NOON + 60_000)

    expect(isRunning(paused)).toBe(false)
    expect(elapsedMs(paused, NOON + 999_999)).toBe(60_000)
  })

  it('adds a second stretch to the first', () => {
    // The whole point: leaving the page and coming back must not lose time.
    const first = pause(start(emptyDay(DAY), new Date(NOON)), NOON + 60_000)
    const second = start(first, new Date(NOON + 120_000))

    expect(elapsedMs(second, NOON + 150_000)).toBe(90_000)
  })

  it('ignores a second start while already running', () => {
    const running = start(emptyDay(DAY), new Date(NOON))
    expect(start(running, new Date(NOON + 30_000))).toEqual(running)
    expect(elapsedMs(start(running, new Date(NOON + 30_000)), NOON + 60_000)).toBe(60_000)
  })

  it('never counts backwards when the machine clock moves', () => {
    const running = start(emptyDay(DAY), new Date(NOON))
    expect(elapsedMs(running, NOON - 60_000)).toBe(0)
  })

  it('starts the count again on a new day', () => {
    const yesterday = pause(start(emptyDay('2026-09-08'), new Date(NOON)), NOON + 3_600_000)
    const today = forDate(yesterday, DAY)

    expect(today).toEqual(emptyDay(DAY))
    // A stretch left running overnight is not carried into the morning.
    const overnight = forDate(start(emptyDay('2026-09-08'), new Date(NOON)), DAY)
    expect(isRunning(overnight)).toBe(false)
    expect(elapsedMs(overnight, NOON)).toBe(0)
  })

  it('keeps the same day untouched', () => {
    const day = start(emptyDay(DAY), new Date(NOON))
    expect(forDate(day, DAY)).toEqual(day)
  })

  it('resets today without touching the date', () => {
    const day = pause(start(emptyDay(DAY), new Date(NOON)), NOON + 60_000)
    expect(reset(day)).toEqual(emptyDay(DAY))
  })
})

describe('reading the clock', () => {
  it('is mm:ss under an hour and h:mm:ss over it', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(9_000)).toBe('00:09')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(7_384_000)).toBe('2:03:04')
  })

  it('never shows a negative time', () => {
    expect(formatElapsed(-5_000)).toBe('00:00')
  })
})
