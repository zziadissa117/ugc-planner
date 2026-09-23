// Motion, from a spring rather than a curve somebody drew.
//
// He chose "physical, quiet": presses give and rebound, a tick pops, a number
// rolls up to its new value, a list settles once when it arrives - and nothing
// moves on its own. The network view earned its look by running a real
// simulation instead of a formula; this is the same idea for time instead of
// space. Each preset is a damped spring, integrated once, and turned into a
// CSS `linear()` easing so the browser plays real physics on the compositor
// with no library and no per-frame JavaScript. Where a value has to be read
// every frame - the money counting up - useSpring runs the same equation live.
//
// Anyone who has asked their device for less motion gets none: every class in
// index.css is switched off under prefers-reduced-motion, and useSpring jumps
// straight to its target.

import { useEffect, useRef, useState } from 'react'

export interface SpringConfig {
  /** How hard it pulls toward the target. */
  stiffness: number
  /** How much it resists moving. Below critical damping it overshoots. */
  damping: number
  mass?: number
}

/** The three springs the app uses, and nothing else - so every movement
 *  belongs to the same physical world. */
export const SPRINGS = {
  /** A button let go of: quick, one small rebound. */
  press: { stiffness: 640, damping: 34 },
  /** A tick landing: the one place allowed a visible bounce, because it is
   *  the moment he did the thing. */
  pop: { stiffness: 420, damping: 19 },
  /** Things arriving and numbers moving: no bounce to speak of. */
  settle: { stiffness: 190, damping: 25 },
} as const satisfies Record<string, SpringConfig>

export type SpringName = keyof typeof SPRINGS

const REST = 0.0005
const STEP = 1 / 600

/** Simulates a spring from 0 to 1 and samples it until it comes to rest.
 *  Returns the position at even steps in time, and how long that took. */
export function simulateSpring(
  config: SpringConfig,
  samples = 48,
): { values: number[]; durationMs: number } {
  const mass = config.mass ?? 1
  let x = 0
  let v = 0
  let t = 0
  const trace: Array<[number, number]> = [[0, 0]]

  // Semi-implicit Euler at 600Hz is far below any error the eye could see,
  // and stable for every spring here. Capped at three seconds so a spring
  // that never settles cannot loop forever.
  while (t < 3) {
    const force = -config.stiffness * (x - 1) - config.damping * v
    v += (force / mass) * STEP
    x += v * STEP
    t += STEP
    trace.push([t, x])
    if (Math.abs(x - 1) < REST && Math.abs(v) < REST * 10) break
  }

  const duration = t
  const values: number[] = []
  let cursor = 0
  for (let i = 0; i <= samples; i++) {
    const at = (duration * i) / samples
    while (cursor < trace.length - 1 && trace[cursor + 1][0] < at) cursor++
    const [t0, x0] = trace[cursor]
    const [t1, x1] = trace[Math.min(cursor + 1, trace.length - 1)]
    const through = t1 === t0 ? 0 : (at - t0) / (t1 - t0)
    values.push(x0 + (x1 - x0) * through)
  }
  values[values.length - 1] = 1
  return { values, durationMs: Math.round(duration * 1000) }
}

/** The spring as a CSS `linear()` easing function. */
export function springEasing(config: SpringConfig, samples = 48): string {
  const { values } = simulateSpring(config, samples)
  return `linear(${values.map((value) => Number(value.toFixed(4))).join(', ')})`
}

/** Writes each spring's easing and duration onto the root element as custom
 *  properties (`--ease-pop`, `--dur-pop`...). index.css carries a
 *  cubic-bezier stand-in for every one, so a browser without `linear()` still
 *  moves - it just moves by a curve rather than by physics. */
export function installSprings(root: HTMLElement = document.documentElement): void {
  const supported =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('transition-timing-function', 'linear(0, 1)')
  for (const [name, config] of Object.entries(SPRINGS)) {
    const { durationMs } = simulateSpring(config)
    root.style.setProperty(`--dur-${name}`, `${durationMs}ms`)
    if (supported) root.style.setProperty(`--ease-${name}`, springEasing(config))
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

/** A number that springs toward `target` each time it changes.
 *
 *  Runs the same equation as the CSS springs, live, one requestAnimationFrame
 *  at a time, and stops the moment it is at rest - nothing ticks while nothing
 *  is moving. Starts at the target, so a value that loads does not count up
 *  from zero as if it had just been earned. */
export function useSpring(target: number, config: SpringConfig = SPRINGS.settle): number {
  const [value, setValue] = useState(target)
  const state = useRef({ x: target, v: 0 })

  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      state.current = { x: target, v: 0 }
      return
    }

    const mass = config.mass ?? 1
    // Rest is judged relative to the distance travelled, so a spring from
    // 0 to 3500 cents and one from 0 to 1 both stop when they look still.
    const scale = Math.max(1, Math.abs(target - state.current.x))
    let frame = 0
    let last = performance.now()

    const step = (now: number) => {
      // Real time, sub-stepped at 240Hz below, so a throttled device - low
      // power mode, a busy phone, a background tab - still lands on time
      // instead of crawling. Only a gap long enough to mean the tab was
      // asleep is cut short; the spring simply finishes on waking.
      let elapsed = Math.min(0.5, (now - last) / 1000)
      last = now
      const s = state.current
      while (elapsed > 0) {
        const dt = Math.min(elapsed, 1 / 240)
        const force = -config.stiffness * (s.x - target) - config.damping * s.v
        s.v += (force / mass) * dt
        s.x += s.v * dt
        elapsed -= dt
      }
      if (Math.abs(s.x - target) < scale * REST && Math.abs(s.v) < scale * REST * 10) {
        s.x = target
        s.v = 0
        setValue(target)
        return
      }
      setValue(s.x)
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, reduced, config.stiffness, config.damping, config.mass])

  // Asked for less motion: the number is simply the number.
  return reduced ? target : value
}
