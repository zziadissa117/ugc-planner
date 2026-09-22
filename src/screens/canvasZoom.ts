// The pure math behind the network view's pan-and-zoom canvas.
//
// The graph itself is laid out in a fixed 0-100 unit space (see
// neuralLayout.ts) rendered into a "stage" element of the same size in CSS
// pixels. A transform - translate then scale, origin at the stage's own
// top-left - is what the viewport actually shows. Keeping that transform as
// plain numbers here, rather than reaching into the DOM for it, is what
// makes zooming toward the cursor and fitting the graph on first paint
// testable without a browser.

export interface CanvasTransform {
  scale: number
  x: number
  y: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 14

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Zooms by `factor` around the point (px, py) - in the viewport's own pixel
 *  space, origin top-left - so that point stays under the cursor rather than
 *  the view recentring on every scroll of the wheel. */
export function zoomAt(current: CanvasTransform, factor: number, px: number, py: number): CanvasTransform {
  const nextScale = clampScale(current.scale * factor)
  const applied = nextScale / current.scale
  return {
    scale: nextScale,
    x: px - (px - current.x) * applied,
    y: py - (py - current.y) * applied,
  }
}

export function panBy(current: CanvasTransform, dx: number, dy: number): CanvasTransform {
  return { ...current, x: current.x + dx, y: current.y + dy }
}

/** How large the automatic fit is allowed to zoom, well short of the
 *  MAX_SCALE a manual pinch or scroll can still reach. A graph with only two
 *  or three tightly clustered nodes has a tiny bounding box, and fitting
 *  that to fill the whole viewport blew every dot and label up past the
 *  point of being readable - the fit is meant to show him the whole graph
 *  at a comfortable size, not zoom in on a small one as far as it can. */
const FIT_MAX_SCALE = 4.5

/** The transform that fits `bounds` (in the same 0-100 stage space the graph
 *  is laid out in) inside `viewport`, so the whole graph is on screen the
 *  moment the canvas opens rather than him having to zoom out to find it
 *  first. `margin` leaves room around the edge - 1 would touch the sides. */
export function fitTransform(bounds: Bounds, viewport: ViewportSize, margin = 0.82): CanvasTransform {
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  const scale = Math.min(
    FIT_MAX_SCALE,
    clampScale(Math.min(viewport.width / width, viewport.height / height) * margin),
  )
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    scale,
    x: viewport.width / 2 - cx * scale,
    y: viewport.height / 2 - cy * scale,
  }
}
