// A tap must still reach whatever is under it.
//
// Chrome retargets the click that follows a pointer-capture to the
// capturing element rather than the element actually under the finger - so
// capturing on every pointerdown, including a plain tap that never moved,
// silently made every node in the graph unreachable. jsdom does not model
// that retargeting, so this cannot catch the browser bug directly; it pins
// down the cause instead - capture must only ever be taken once a real drag
// has been confirmed, never on a pointerdown alone.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NeuralCanvas } from './NeuralCanvas'

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

function renderCanvas() {
  return render(
    <NeuralCanvas bounds={bounds}>
      <button type="button">a node</button>
    </NeuralCanvas>,
  )
}

/** The viewport is the direct child that carries the pointer/wheel handlers
 *  - the outer div is only the black, bordered frame around it. */
function viewport() {
  return screen.getByText('a node').closest('div')!.parentElement!
}

describe("a tap that never moves", () => {
  it('does not take pointer capture, so the click underneath is not retargeted', () => {
    renderCanvas()
    const el = viewport()
    const capture = vi.fn()
    Object.defineProperty(el, 'setPointerCapture', { value: capture, configurable: true })

    fireEvent.pointerDown(el, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 50, clientY: 50, pointerId: 1 })

    expect(capture).not.toHaveBeenCalled()
  })

  it('still lets the click through to the node underneath', () => {
    renderCanvas()
    const el = viewport()
    const onClick = vi.fn()
    screen.getByText('a node').addEventListener('click', onClick)

    fireEvent.pointerDown(el, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.click(screen.getByText('a node'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('a real drag', () => {
  it('takes pointer capture only once it crosses the drag threshold', () => {
    renderCanvas()
    const el = viewport()
    const capture = vi.fn()
    Object.defineProperty(el, 'setPointerCapture', { value: capture, configurable: true })

    fireEvent.pointerDown(el, { clientX: 50, clientY: 50, pointerId: 1 })
    // Inside the threshold: still a tap, capture must not fire yet.
    fireEvent.pointerMove(el, { clientX: 52, clientY: 51, pointerId: 1 })
    expect(capture).not.toHaveBeenCalled()

    // Past the threshold: now it is a drag.
    fireEvent.pointerMove(el, { clientX: 80, clientY: 60, pointerId: 1 })
    expect(capture).toHaveBeenCalledTimes(1)
  })
})
