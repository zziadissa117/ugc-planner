// The sound is a flourish. What is tested is that it can never take a tick
// down with it - the tap that records a day's work must land whatever the
// browser thinks of audio.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isMuted, playCashRegister, setMuted } from './sound'

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
