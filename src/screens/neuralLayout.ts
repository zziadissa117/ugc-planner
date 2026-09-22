// A small force-directed layout for the Post screen's network view.
//
// The first version put every campaign on a perfect circle around a centre
// node - "this does not look good," and what he pointed at instead was a real
// knowledge-graph: nodes of different sizes scattered organically, thin
// edges, natural clustering. A ring of evenly spaced spokes can never look
// like that, however it is drawn - the shape itself is the problem, not the
// line weight.
//
// So positions are settled by a tiny physics simulation instead of a formula:
// every node repels every other node, every edge pulls its two ends toward a
// resting length, and the whole thing is nudged gently toward the centre so
// it does not drift off into space. Run for enough steps, it relaxes into
// clusters the way a real graph does. No dependency - the whole thing is a
// few dozen lines, and the app's rule against adding one still holds.
//
// It is a pure function of the node and edge list, so the caller memoises it
// keyed on the graph's shape (which campaigns, which accounts) and never on
// anything that changes every tap, like how many posts have gone out today.

export interface NetworkNodeDef {
  id: string
  /** Node radius, in the 0-100 canvas the layout works in. */
  r: number
  /** Seeds this node's starting position near its parent rather than near
   *  the centre - used for a platform node, which belongs near its campaign
   *  from the first frame rather than drifting there over many iterations. */
  parentId?: string
}

export interface NetworkEdgeDef {
  a: string
  b: string
  /** The edge's resting length once the simulation settles. */
  ideal: number
}

export interface NetworkPoint {
  x: number
  y: number
}

/** A stable pseudo-random value in [0, 1) for a string, so the same graph
 *  shape always settles into the same-looking layout rather than reshuffling
 *  every time it is recomputed. Not cryptographic - just deterministic. */
function seedFor(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}

const REPULSION = 58
const SPRING = 0.02
const CENTER_PULL = 0.006
const DAMPING = 0.82
const ITERATIONS = 260
/** How far from the centre a node may settle before everything is scaled
 *  back down to fit - the canvas is 0-100 with the centre at (50, 50). */
const CANVAS_LIMIT = 44

/** One node whose position is 'core' - fixed at the canvas centre and never
 *  moved by the simulation. Everything else is free. */
export const CORE_ID = 'core'

export function layoutNetwork(
  nodeDefs: readonly NetworkNodeDef[],
  edgeDefs: readonly NetworkEdgeDef[],
): Map<string, NetworkPoint> {
  interface Body extends NetworkPoint {
    vx: number
    vy: number
    fixed: boolean
  }

  const bodies = new Map<string, Body>()

  for (const def of nodeDefs) {
    if (def.id === CORE_ID) {
      bodies.set(def.id, { x: 50, y: 50, vx: 0, vy: 0, fixed: true })
      continue
    }
    // Scattered near its parent (or the centre, for a top-level node) rather
    // than at a fixed angle, so a handful of runs of the same shape do not
    // all start from an identical wheel the simulation then has to undo.
    const parent = def.parentId ? bodies.get(def.parentId) : undefined
    const originX = parent?.x ?? 50
    const originY = parent?.y ?? 50
    const angle = seedFor(def.id) * Math.PI * 2
    const radius = parent ? 13 : 30
    bodies.set(def.id, {
      x: originX + Math.cos(angle) * radius,
      y: originY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      fixed: false,
    })
  }

  const ids = [...bodies.keys()]

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const fx = new Map<string, number>(ids.map((id) => [id, 0]))
    const fy = new Map<string, number>(ids.map((id) => [id, 0]))

    // Every pair pushes apart - what keeps nodes from stacking on top of
    // each other. Cheap enough at this scale (a handful of campaigns, a
    // handful of platforms each) to do plainly, with no spatial index.
    for (let i = 0; i < ids.length; i++) {
      const a = bodies.get(ids[i])!
      for (let j = i + 1; j < ids.length; j++) {
        const b = bodies.get(ids[j])!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist = Math.hypot(dx, dy)
        if (dist < 0.01) {
          // Exactly coincident (two nodes seeded to the same spot): nudge
          // apart deterministically rather than dividing by zero.
          dx = seedFor(ids[i] + ids[j]) - 0.5
          dy = seedFor(ids[j] + ids[i]) - 0.5
          dist = Math.hypot(dx, dy) || 0.01
        }
        const force = REPULSION / Math.max(dist, 3) ** 2
        const ux = dx / dist
        const uy = dy / dist
        fx.set(ids[i], fx.get(ids[i])! + ux * force)
        fy.set(ids[i], fy.get(ids[i])! + uy * force)
        fx.set(ids[j], fx.get(ids[j])! - ux * force)
        fy.set(ids[j], fy.get(ids[j])! - uy * force)
      }
    }

    // Every edge pulls its two ends toward its resting length - what turns
    // the repelled cloud of points into a graph rather than a gas.
    for (const edge of edgeDefs) {
      const a = bodies.get(edge.a)
      const b = bodies.get(edge.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.01
      const force = (dist - edge.ideal) * SPRING
      const ux = dx / dist
      const uy = dy / dist
      fx.set(edge.a, fx.get(edge.a)! + ux * force)
      fy.set(edge.a, fy.get(edge.a)! + uy * force)
      fx.set(edge.b, fx.get(edge.b)! - ux * force)
      fy.set(edge.b, fy.get(edge.b)! - uy * force)
    }

    for (const id of ids) {
      const body = bodies.get(id)!
      if (body.fixed) continue
      // A weak pull toward the centre - not enough to fight the edges into a
      // wheel again, just enough that a graph with few edges does not drift
      // off toward one corner over hundreds of iterations.
      const cx = (50 - body.x) * CENTER_PULL
      const cy = (50 - body.y) * CENTER_PULL
      body.vx = (body.vx + fx.get(id)! + cx) * DAMPING
      body.vy = (body.vy + fy.get(id)! + cy) * DAMPING
      body.x += body.vx
      body.y += body.vy
    }
  }

  // Whatever the simulation settled on, it has to fit the canvas it will
  // actually be drawn on - scaled as one shape rather than clamped node by
  // node, which would distort the clustering it just worked out.
  let maxDist = 0
  for (const id of ids) {
    if (id === CORE_ID) continue
    const body = bodies.get(id)!
    maxDist = Math.max(maxDist, Math.hypot(body.x - 50, body.y - 50))
  }
  const scale = maxDist > CANVAS_LIMIT ? CANVAS_LIMIT / maxDist : 1

  const positions = new Map<string, NetworkPoint>()
  for (const id of ids) {
    const body = bodies.get(id)!
    positions.set(id, {
      x: id === CORE_ID ? 50 : 50 + (body.x - 50) * scale,
      y: id === CORE_ID ? 50 : 50 + (body.y - 50) * scale,
    })
  }
  return positions
}
