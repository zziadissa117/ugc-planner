// The pan-and-zoom transform math: does zooming keep the cursor's point
// fixed, does the scale stay clamped, does the initial fit actually show
// the whole graph?

import { describe, expect, it } from 'vitest'

import { clampScale, fitTransform, panBy, zoomAt, MAX_SCALE, MIN_SCALE } from './canvasZoom'

describe('clampScale', () => {
  it('never goes below the minimum or above the maximum', () => {
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(-5)).toBe(MIN_SCALE)
    expect(clampScale(999)).toBe(MAX_SCALE)
  })
})

describe('zoomAt', () => {
  it('keeps the point under the cursor in the same screen spot', () => {
    const start = { scale: 2, x: 10, y: 10 }
    const cursor = { px: 150, py: 80 }
    const next = zoomAt(start, 1.5, cursor.px, cursor.py)

    // The stage-local point that was under the cursor before zooming...
    const before = { x: (cursor.px - start.x) / start.scale, y: (cursor.py - start.y) / start.scale }
    // ...must still land on the cursor after the new transform is applied.
    const after = { x: next.x + before.x * next.scale, y: next.y + before.y * next.scale }
    expect(after.x).toBeCloseTo(cursor.px)
    expect(after.y).toBeCloseTo(cursor.py)
  })

  it('actually changes the scale by the given factor, within the clamp', () => {
    const next = zoomAt({ scale: 3, x: 0, y: 0 }, 1.2, 50, 50)
    expect(next.scale).toBeCloseTo(3.6)
  })

  it('stops at the minimum rather than zooming out forever', () => {
    const next = zoomAt({ scale: MIN_SCALE, x: 0, y: 0 }, 0.1, 50, 50)
    expect(next.scale).toBe(MIN_SCALE)
  })
})

describe('panBy', () => {
  it('moves the transform and leaves the scale alone', () => {
    const next = panBy({ scale: 2.5, x: 10, y: -5 }, 20, 30)
    expect(next).toEqual({ scale: 2.5, x: 30, y: 25 })
  })
})

describe('fitTransform', () => {
  it('centres the bounds in the viewport', () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { width: 400, height: 400 })
    // The bounds' own centre (50, 50) must land on the viewport's centre.
    const screenX = t.x + 50 * t.scale
    const screenY = t.y + 50 * t.scale
    expect(screenX).toBeCloseTo(200)
    expect(screenY).toBeCloseTo(200)
  })

  it('shrinks to fit a wide graph inside a square viewport', () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 200, maxY: 50 }, { width: 400, height: 400 }, 1)
    // The limiting dimension is the width (200 units into 400px = scale 2),
    // not the height, which would allow a much larger scale on its own.
    expect(t.scale).toBeCloseTo(2)
  })

  it('never picks a scale outside the normal clamp', () => {
    const tiny = fitTransform({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 400, height: 400 })
    expect(tiny.scale).toBeLessThanOrEqual(MAX_SCALE)
    const huge = fitTransform({ minX: 0, minY: 0, maxX: 5000, maxY: 5000 }, { width: 400, height: 400 })
    expect(huge.scale).toBeGreaterThanOrEqual(MIN_SCALE)
  })
})
