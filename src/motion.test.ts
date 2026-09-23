import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SPRINGS, installSprings, simulateSpring, springEasing, useSpring } from './motion'

describe('the springs', () => {
  it('start at rest at 0 and end exactly at 1', () => {
    for (const config of Object.values(SPRINGS)) {
      const { values } = simulateSpring(config)
      expect(values[0]).toBe(0)
      expect(values[values.length - 1]).toBe(1)
    }
  })

  it('settle in well under a second - quiet, not floaty', () => {
    for (const config of Object.values(SPRINGS)) {
      expect(simulateSpring(config).durationMs).toBeLessThan(1000)
    }
  })

  it('lets only the tick visibly overshoot', () => {
    const peak = (config: (typeof SPRINGS)[keyof typeof SPRINGS]) =>
      Math.max(...simulateSpring(config, 200).values)
    // The pop is the moment he did the thing; it is allowed a bounce.
    expect(peak(SPRINGS.pop)).toBeGreaterThan(1.1)
    // Arrivals do not wobble.
    expect(peak(SPRINGS.settle)).toBeLessThan(1.02)
  })

  it('writes a valid linear() easing', () => {
    const easing = springEasing(SPRINGS.pop, 8)
    expect(easing).toMatch(/^linear\(0, [\d., -]+, 1\)$/)
    expect(easing.split(',')).toHaveLength(9)
  })

  it('always installs a duration, and the physics only where the browser can play it', () => {
    const supports = vi.spyOn(CSS, 'supports')

    supports.mockReturnValue(false)
    const old = document.createElement('div')
    installSprings(old)
    expect(old.style.getPropertyValue('--dur-pop')).toMatch(/^\d+ms$/)
    // No linear(): the cubic-bezier stand-in in index.css stays in charge.
    expect(old.style.getPropertyValue('--ease-pop')).toBe('')

    supports.mockReturnValue(true)
    const current = document.createElement('div')
    installSprings(current)
    expect(current.style.getPropertyValue('--ease-pop')).toMatch(/^linear\(/)

    supports.mockRestore()
  })
})

describe('useSpring', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at its target rather than counting up from nothing', () => {
    const { result } = renderHook(() => useSpring(3500))
    expect(result.current).toBe(3500)
  })

  it('moves toward a new target and comes to rest exactly on it', async () => {
    const { result, rerender } = renderHook(({ target }) => useSpring(target), {
      initialProps: { target: 0 },
    })
    rerender({ target: 3500 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    })
    expect(result.current).toBe(3500)
  })
})
