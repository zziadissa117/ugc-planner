// The pan-and-zoom black canvas the network view lives inside.
//
// "Make it so I can zoom inside of it, like it's a sort of sandbox... Make
// that little rectangle pitch black." So this is a real viewport rather than
// a fixed picture: content sits in a 100x100 "stage" (the same unit space
// neuralLayout.ts works in), a CSS transform on that stage is what he
// actually pans and zooms, and the outer box that clips it is plain black,
// nothing painted behind the graph.
//
// The transform math itself lives in canvasZoom.ts, tested on its own -
// everything here is wiring it to real pointer and wheel events.
//
// It hands its children two converters rather than raw numbers, because the
// stage has two coordinate systems and mixing them is an easy, invisible
// mistake: `px` for anything with a CSS size (a dot, a label), `svg` for a
// length inside the SVG's own 0-100 viewBox (a stroke width). Both take
// "how many screen pixels this should be at the fitted view", so the graph
// looks identical on a phone and a laptop whatever scale the fit lands on,
// and the fit is free to zoom as far as filling the screen takes.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'

import { FitIcon, MinusIcon, PlusIcon } from '../components/icons'
import { fitTransform, zoomAt, type Bounds, type CanvasTransform } from './canvasZoom'

/** The stage's own size in CSS pixels, for the 0-100 unit space the graph is
 *  laid out in - ten CSS pixels to the unit.
 *
 *  It used to be 100px, one pixel to the unit, and that quietly forced every
 *  label to a sub-pixel font size: the canvas then scaled it back up, which
 *  is how you get blurry text. At ten to the unit a 12px label really is
 *  declared as roughly 12px and the browser rasterises it properly. Nothing
 *  else changes - children position themselves in percentages, which resolve
 *  against whatever this is. */
const STAGE_PX = 1000
const PX_PER_UNIT = STAGE_PX / 100

export interface CanvasSizes {
  /** A CSS length, for an element with a CSS size, that renders as `n`
   *  screen pixels at the fitted view. */
  px: (n: number) => number
  /** A length in the SVG's own 0-100 viewBox - a stroke width, say - that
   *  renders as `n` screen pixels at the fitted view. */
  svg: (n: number) => number
}

/** Screen pixels of movement before a pointer-down is treated as a drag
 *  rather than a tap - below this it still reaches the node underneath. A
 *  real tap is rarely perfectly still; too tight a threshold here turned an
 *  ordinary tap into a phantom micro-drag that then ate the tap behind it. */
const DRAG_THRESHOLD = 10

export function NeuralCanvas({
  bounds,
  children,
  className = '',
}: {
  /** The graph's extent in stage units (see neuralLayout.ts) - already
   *  padded by the caller for node radii and label width. */
  bounds: Bounds
  children: (sizes: CanvasSizes) => ReactNode
  className?: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState<CanvasTransform>({ scale: 1, x: 0, y: 0 })
  const boundsKey = `${bounds.minX}:${bounds.minY}:${bounds.maxX}:${bounds.maxY}`
  // The caller thinks in the layout's 0-100 units; everything below is in
  // the stage's own CSS pixels, which is what the transform operates on.
  const boundsPx: Bounds = {
    minX: bounds.minX * PX_PER_UNIT,
    minY: bounds.minY * PX_PER_UNIT,
    maxX: bounds.maxX * PX_PER_UNIT,
    maxY: bounds.maxY * PX_PER_UNIT,
  }

  // The viewport's own real size, in pixels - both the initial fit and
  // zooming toward the cursor need it, and neither can just assume the
  // container's CSS size. Falls back to a window resize listener where
  // ResizeObserver does not exist - an older browser, or a test environment
  // - rather than throwing and leaving the canvas with no size at all.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // One screen pixel at the fitted view, in stage units. Held to the FIT
  // scale rather than the live one on purpose: zooming in should magnify the
  // graph the way zooming into any diagram does, not hold everything at a
  // fixed size while only the gaps grow.
  const sizes = useMemo<CanvasSizes>(() => {
    const unit =
      viewport.width === 0 || viewport.height === 0
        ? PX_PER_UNIT
        : 1 / fitTransform(boundsPx, viewport).scale
    return { px: (n) => n * unit, svg: (n) => (n * unit) / PX_PER_UNIT }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, boundsKey])

  const fit = useCallback(() => {
    if (viewport.width === 0 || viewport.height === 0) return
    setTransform(fitTransform(boundsPx, viewport))
    // Keyed on the bounds' own values and the measured size, not on the
    // `bounds` object identity, which is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, boundsKey])

  // Fits the moment the viewport is measured, and again whenever the graph's
  // own shape changes - a campaign gaining an account should not leave it
  // sitting off screen with no sign anything is there to scroll to.
  useEffect(() => {
    fit()
  }, [fit])

  const drag = useRef({ down: false, moved: false, startX: 0, startY: 0, startTx: 0, startTy: 0 })
  // A drag that ends on top of a node leaves a click behind it; this is what
  // that click checks before letting the node's own tap through.
  const justDragged = useRef(false)

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    drag.current = {
      down: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      startTx: transform.x,
      startTy: transform.y,
    }
    // Capture is deliberately not taken here. Chrome retargets the click
    // that follows to whichever element holds capture - so capturing on
    // every pointerdown, including a plain tap that never moves, sent every
    // tap's click to this container instead of the node underneath it, and
    // no node was ever reachable. It is taken below, once a real drag is
    // confirmed, which is the only time redirecting events here is wanted.
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag.current.down) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (!drag.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!drag.current.moved) event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current.moved = true
    setTransform((current) => ({ ...current, x: drag.current.startTx + dx, y: drag.current.startTy + dy }))
  }

  const endDrag = () => {
    if (drag.current.moved) justDragged.current = true
    drag.current.down = false
  }

  const onClickCapture = (event: ReactMouseEvent) => {
    if (!justDragged.current) return
    event.preventDefault()
    event.stopPropagation()
    justDragged.current = false
  }

  const onWheel = (event: ReactWheelEvent) => {
    event.preventDefault()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    // Exponential rather than linear, so a trackpad's small, frequent deltas
    // and a mouse wheel's large, occasional ones both feel proportionate.
    const factor = Math.exp(-event.deltaY * 0.0018)
    setTransform((current) => zoomAt(current, factor, px, py))
  }

  const zoomBy = (factor: number) => () => {
    setTransform((current) => zoomAt(current, factor, viewport.width / 2, viewport.height / 2))
  }

  return (
    <div className={`relative overflow-hidden bg-ink ${className}`}>
      <div
        ref={viewportRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        // touch-none: without it a one-finger drag also tries to scroll the
        // page underneath, and the two fight each other.
        className="relative h-full w-full touch-none select-none [cursor:grab] active:[cursor:grabbing]"
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: `${STAGE_PX}px`,
            height: `${STAGE_PX}px`,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {children(sizes)}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-edge bg-ink/80 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={zoomBy(0.75)}
            aria-label="Zoom out"
            className="press flex size-10 items-center justify-center rounded-full text-state-later active:bg-surface"
          >
            <MinusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={fit}
            aria-label="Reset the view"
            className="press flex size-10 items-center justify-center rounded-full text-state-later active:bg-surface"
          >
            <FitIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={zoomBy(1.3)}
            aria-label="Zoom in"
            className="press flex size-10 items-center justify-center rounded-full text-state-later active:bg-surface"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
