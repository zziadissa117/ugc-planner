// The network view's force layout: does it actually spread nodes out,
// respect edges, stay inside the canvas, and settle the same way twice?

import { describe, expect, it } from 'vitest'

import { CORE_ID, layoutNetwork } from './neuralLayout'

describe('layoutNetwork', () => {
  it('keeps the core fixed at the centre', () => {
    const positions = layoutNetwork(
      [
        { id: CORE_ID, r: 8 },
        { id: 'a', r: 5 },
      ],
      [{ a: CORE_ID, b: 'a', ideal: 26 }],
    )
    expect(positions.get(CORE_ID)).toEqual({ x: 50, y: 50 })
  })

  it('is deterministic - the same graph settles the same way every time', () => {
    const nodes = [
      { id: CORE_ID, r: 8 },
      { id: 'a', r: 5 },
      { id: 'b', r: 5 },
      { id: 'c', r: 5 },
    ]
    const edges = [
      { a: CORE_ID, b: 'a', ideal: 26 },
      { a: CORE_ID, b: 'b', ideal: 26 },
      { a: CORE_ID, b: 'c', ideal: 26 },
    ]
    const first = layoutNetwork(nodes, edges)
    const second = layoutNetwork(nodes, edges)
    for (const id of ['a', 'b', 'c']) {
      expect(second.get(id)).toEqual(first.get(id))
    }
  })

  it('spreads sibling nodes apart rather than stacking them', () => {
    const positions = layoutNetwork(
      [
        { id: CORE_ID, r: 8 },
        { id: 'a', r: 5 },
        { id: 'b', r: 5 },
      ],
      [
        { a: CORE_ID, b: 'a', ideal: 26 },
        { a: CORE_ID, b: 'b', ideal: 26 },
      ],
    )
    const a = positions.get('a')!
    const b = positions.get('b')!
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(8)
  })

  it('settles every node within the canvas, whatever the graph shape', () => {
    const nodes = [{ id: CORE_ID, r: 8 }]
    const edges: { a: string; b: string; ideal: number }[] = []
    for (let i = 0; i < 8; i++) {
      nodes.push({ id: `campaign-${i}`, r: 5 })
      edges.push({ a: CORE_ID, b: `campaign-${i}`, ideal: 26 })
      for (let j = 0; j < 3; j++) {
        nodes.push({ id: `campaign-${i}-platform-${j}`, r: 2 })
        edges.push({ a: `campaign-${i}`, b: `campaign-${i}-platform-${j}`, ideal: 9 })
      }
    }
    const positions = layoutNetwork(nodes, edges)
    for (const [id, point] of positions) {
      if (id === CORE_ID) continue
      expect(Math.hypot(point.x - 50, point.y - 50)).toBeLessThanOrEqual(44.01)
    }
  })

  it('pulls a platform node toward its own campaign, not toward a stranger campaign', () => {
    const positions = layoutNetwork(
      [
        { id: CORE_ID, r: 8 },
        { id: 'campaignA', r: 5 },
        { id: 'campaignB', r: 5 },
        { id: 'leafA', r: 2, parentId: 'campaignA' },
      ],
      [
        { a: CORE_ID, b: 'campaignA', ideal: 26 },
        { a: CORE_ID, b: 'campaignB', ideal: 26 },
        { a: 'campaignA', b: 'leafA', ideal: 9 },
      ],
    )
    const campaignA = positions.get('campaignA')!
    const campaignB = positions.get('campaignB')!
    const leafA = positions.get('leafA')!
    const distToOwnParent = Math.hypot(leafA.x - campaignA.x, leafA.y - campaignA.y)
    const distToOtherCampaign = Math.hypot(leafA.x - campaignB.x, leafA.y - campaignB.y)
    expect(distToOwnParent).toBeLessThan(distToOtherCampaign)
  })

  it('handles a single node with no edges at all', () => {
    const positions = layoutNetwork([{ id: CORE_ID, r: 8 }], [])
    expect(positions.get(CORE_ID)).toEqual({ x: 50, y: 50 })
    expect(positions.size).toBe(1)
  })
})
