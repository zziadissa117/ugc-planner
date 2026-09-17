// The sound is a flourish. What is tested is that it can never take a tick
// down with it - the tap that records a day's work must land whatever the
// browser thinks of audio.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isMuted, playCashRegister, scheduleCashRegister, setMuted } from './sound'

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('muting', () => {
  it('is off until he turns it on, and remembers it', () => {
    expect(isMuted()).toBe(false)
    setMuted(true)
    expect(isMuted()).toBe(true)
    setMuted(false)
    expect(isMuted()).toBe(false)
  })

  it('treats blocked storage as unmuted rather than throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => setMuted(true)).not.toThrow()
    expect(isMuted()).toBe(false)
  })
})

describe('playing it', () => {
  it('does nothing at all when muted', () => {
    const Ctor = vi.fn()
    vi.stubGlobal('AudioContext', Ctor)
    setMuted(true)

    playCashRegister()
    expect(Ctor).not.toHaveBeenCalled()
  })

  it('survives a browser with no AudioContext', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => playCashRegister()).not.toThrow()
  })

  it('survives an AudioContext that refuses to be built', () => {
    vi.stubGlobal('AudioContext', function () {
      throw new Error('not allowed')
    })
    expect(() => playCashRegister()).not.toThrow()
  })

  it('survives an oscillator that throws mid-sound', () => {
    vi.stubGlobal(
      'AudioContext',
      function (this: Record<string, unknown>) {
        this.state = 'running'
        this.currentTime = 0
        this.destination = {}
        this.createOscillator = () => {
          throw new Error('no')
        }
        this.createGain = () => ({})
      },
    )
    expect(() => playCashRegister()).not.toThrow()
  })
})

describe('being audible on iOS at all', () => {
  // He could see Safari's "audio playing" indicator and hear nothing. On iOS,
  // Web Audio defaults to the ambient session, which the hardware silent
  // switch mutes - the sound is produced and routed nowhere.
  it('claims the playback session before building the context', () => {
    const session = { type: 'auto' }
    vi.stubGlobal('navigator', { ...navigator, audioSession: session })
    vi.stubGlobal('AudioContext', function (this: Record<string, unknown>) {
      // If the category is claimed after the context is built, the first
      // sound can still go out on the old one.
      expect(session.type).toBe('playback')
      this.state = 'running'
      this.currentTime = 0
      this.destination = {}
      this.createBufferSource = () => ({
        buffer: null,
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      })
      this.createBuffer = () => ({ getChannelData: () => new Float32Array(8) })
      this.createGain = () => ({
        gain: {
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: (next: unknown) => next,
      })
      this.createBiquadFilter = () => ({
        type: '',
        frequency: { setValueAtTime: () => undefined },
        Q: { setValueAtTime: () => undefined },
        connect: (next: unknown) => next,
      })
      this.createOscillator = () => ({
        type: '',
        frequency: { setValueAtTime: () => undefined },
        connect: (next: unknown) => next,
        start: () => undefined,
        stop: () => undefined,
      })
    })

    playCashRegister()
    expect(session.type).toBe('playback')
  })

  it('does nothing where there is no audio session to claim', () => {
    // Every platform but Safari. Nothing else mutes Web Audio behind a switch.
    vi.stubGlobal('navigator', { ...navigator, audioSession: undefined })
    expect(() => playCashRegister()).not.toThrow()
  })
})

describe('the shape of the sound', () => {
  // What separates a till from a doorbell, checked against a recording
  // context rather than by ear. Rendered offline in a real browser it comes
  // out as a 3.6kHz transient peaking loudest, then a 1.6kHz bell ringing for
  // about a second and landing at silence - these assertions are what keeps
  // that true.
  function recorder() {
    const oscillators: { hz: number; start: number; stop: number }[] = []
    const noise: { start: number; filtered: number[] }[] = []
    const filters: number[] = []

    const gain = () => ({
      gain: {
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: (next: unknown) => next,
    })

    const ctx = {
      sampleRate: 44100,
      currentTime: 0,
      destination: {},
      createOscillator: () => {
        const entry = { hz: 0, start: 0, stop: 0 }
        oscillators.push(entry)
        return {
          type: '',
          frequency: {
            setValueAtTime: (hz: number) => {
              entry.hz = hz
            },
          },
          connect: (next: unknown) => next,
          start: (at: number) => {
            entry.start = at
          },
          stop: (at: number) => {
            entry.stop = at
          },
        }
      },
      createGain: gain,
      createBuffer: (_channels: number, frames: number) => ({
        getChannelData: () => new Float32Array(frames),
      }),
      createBufferSource: () => {
        const entry = { start: 0, filtered: filters }
        noise.push(entry)
        return {
          buffer: null,
          connect: (next: unknown) => next,
          start: (at: number) => {
            entry.start = at
          },
          stop: () => {},
        }
      },
      createBiquadFilter: () => ({
        type: '',
        frequency: {
          setValueAtTime: (hz: number) => {
            filters.push(hz)
          },
        },
        Q: { setValueAtTime: () => {} },
        connect: (next: unknown) => next,
      }),
    }
    return { ctx, oscillators, noise, filters }
  }

  it('opens with a burst of filtered noise, not with a note', () => {
    // The drawer. Without it this is a bell on its own, which is a chime.
    const { ctx, noise, filters } = recorder()
    scheduleCashRegister(ctx as never, 0)

    expect(noise).toHaveLength(1)
    expect(noise[0].start).toBe(0)
    // High and narrow, so it reads as struck metal rather than as static.
    expect(filters[0]).toBeGreaterThan(2000)
  })

  it('strikes the bell twice, the second later and higher', () => {
    // One strike is a bell. Two is a till.
    const { ctx, oscillators } = recorder()
    scheduleCashRegister(ctx as never, 0)

    const starts = [...new Set(oscillators.map((o) => o.start))].sort((a, b) => a - b)
    expect(starts).toHaveLength(2)
    expect(starts[1]).toBeGreaterThan(starts[0])

    const firstFundamental = Math.min(...oscillators.filter((o) => o.start === starts[0]).map((o) => o.hz))
    const secondFundamental = Math.min(...oscillators.filter((o) => o.start === starts[1]).map((o) => o.hz))
    expect(secondFundamental).toBeGreaterThan(firstFundamental)
  })

  it('gives each strike inharmonic partials - this is the whole difference', () => {
    // Overtones at whole multiples are an organ. A bell's sit at 2.76x, 5.4x,
    // 8.93x, and that is what makes it read as metal.
    const { ctx, oscillators } = recorder()
    scheduleCashRegister(ctx as never, 0)

    const first = oscillators.filter((o) => o.start === Math.min(...oscillators.map((x) => x.start)))
    expect(first.length).toBeGreaterThan(3)

    const fundamental = Math.min(...first.map((o) => o.hz))
    const ratios = first.map((o) => o.hz / fundamental).sort((a, b) => a - b)

    // Not every partial has to be far off a whole multiple - 8.93x sits near
    // 9x in the real series - but the low ones carry the character, and if
    // these ever became 2x and 3x it would be an organ.
    const offAWholeMultiple = ratios
      .slice(1)
      .filter((ratio) => Math.abs(ratio - Math.round(ratio)) > 0.2)
    expect(offAWholeMultiple.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(ratios[1] - Math.round(ratios[1]))).toBeGreaterThan(0.2)
  })

  it('is over in about a second', () => {
    const { ctx, oscillators } = recorder()
    scheduleCashRegister(ctx as never, 0)
    const last = Math.max(...oscillators.map((o) => o.stop))
    expect(last).toBeGreaterThan(0.5)
    expect(last).toBeLessThan(1.5)
  })

  it('still refuses to throw when the context is hostile', () => {
    vi.stubGlobal('AudioContext', function (this: Record<string, unknown>) {
      this.state = 'running'
      this.currentTime = 0
      this.destination = {}
      this.createBuffer = () => {
        throw new Error('no')
      }
    })
    expect(() => playCashRegister()).not.toThrow()
  })
})
