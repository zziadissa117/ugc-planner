import { describe, expect, it } from 'vitest'

import {
  OLD_TODO_KEY,
  PRIORITIES_KEY,
  TODAY_LIMIT,
  add,
  answer,
  arrange,
  clearDone,
  groupOf,
  loadPriorities,
  moveUp,
  newPriority,
  putOnToday,
  remove,
  resort,
  setDone,
  setWhen,
  takeOffToday,
  type Priority,
} from './priorities'

const at = (n: number) => new Date(Date.UTC(2026, 9, 7, 12, n))

function sorted(text: string, important: boolean, urgent: boolean, n = 0): Priority {
  return { ...newPriority(text, at(n), text), important, urgent }
}

describe('sorting into groups', () => {
  it('starts unsorted until both questions are answered', () => {
    let list = add([], 'Film Vertus hooks', at(0))
    expect(groupOf(list[0])).toBe('unsorted')
    list = answer(list, list[0].id, 'important', true)
    expect(groupOf(list[0])).toBe('unsorted')
    list = answer(list, list[0].id, 'urgent', false)
    expect(groupOf(list[0])).toBe('plan')
  })

  it('places each pair of answers like the matrix', () => {
    expect(groupOf(sorted('a', true, true))).toBe('doFirst')
    expect(groupOf(sorted('b', true, false))).toBe('plan')
    expect(groupOf(sorted('c', false, true))).toBe('batch')
    expect(groupOf(sorted('d', false, false))).toBe('drop')
  })

  it('ignores a blank line', () => {
    expect(add([], '   ')).toEqual([])
  })

  it('can be sent back to be sorted again, off Today', () => {
    let list = putOnToday([sorted('a', true, true)], 'a')
    list = resort(list, 'a')
    expect(groupOf(list[0])).toBe('unsorted')
    expect(list[0].rank).toBeNull()
  })
})

describe('Today', () => {
  it('ranks in the order things are put on it', () => {
    let list = [sorted('a', true, true, 1), sorted('b', true, false, 2), sorted('c', false, true, 3)]
    list = putOnToday(list, 'b')
    list = putOnToday(list, 'a')
    expect(arrange(list).today.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it(`holds at most ${TODAY_LIMIT}`, () => {
    let list = ['a', 'b', 'c', 'd'].map((id, i) => sorted(id, true, true, i))
    for (const id of ['a', 'b', 'c', 'd']) list = putOnToday(list, id)
    expect(arrange(list).today.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(groupOf(list.find((p) => p.id === 'd')!)).toBe('doFirst')
  })

  it('will not take something that is not sorted yet', () => {
    const list = putOnToday([newPriority('x', at(0), 'x')], 'x')
    expect(list[0].rank).toBeNull()
  })

  it('moves one up, and the top stays put', () => {
    let list = [sorted('a', true, true, 1), sorted('b', true, true, 2)]
    list = putOnToday(putOnToday(list, 'a'), 'b')
    list = moveUp(list, 'b')
    expect(arrange(list).today.map((p) => p.id)).toEqual(['b', 'a'])
    expect(moveUp(list, 'b')).toEqual(list)
  })

  it('makes the next one "do this now" when the top one is done', () => {
    let list = [sorted('a', true, true, 1), sorted('b', true, true, 2), sorted('c', true, true, 3)]
    for (const id of ['a', 'b', 'c']) list = putOnToday(list, id)
    list = setDone(list, 'a', true, at(9))
    const today = arrange(list).today
    expect(today.map((p) => [p.id, p.rank])).toEqual([
      ['b', 1],
      ['c', 2],
    ])
    expect(arrange(list).done.map((p) => p.id)).toEqual(['a'])
  })

  it('leaves no gaps when one comes off or is deleted', () => {
    let list = [sorted('a', true, true, 1), sorted('b', true, true, 2), sorted('c', true, true, 3)]
    for (const id of ['a', 'b', 'c']) list = putOnToday(list, id)
    list = takeOffToday(list, 'b')
    expect(arrange(list).today.map((p) => p.rank)).toEqual([1, 2])
    list = remove(list, 'a')
    expect(arrange(list).today.map((p) => [p.id, p.rank])).toEqual([['c', 1]])
  })

  it('puts something un-ticked back in its group, not on Today', () => {
    let list = putOnToday([sorted('a', true, true)], 'a')
    list = setDone(list, 'a', true)
    list = setDone(list, 'a', false)
    expect(groupOf(list[0])).toBe('doFirst')
  })
})

describe('the rest', () => {
  it('keeps a when, and clears it when emptied', () => {
    let list = setWhen([sorted('a', true, false)], 'a', ' Sunday 10am at the desk ')
    expect(list[0].when).toBe('Sunday 10am at the desk')
    list = setWhen(list, 'a', '')
    expect(list[0].when).toBeUndefined()
  })

  it('clears only what is done', () => {
    const list = setDone([sorted('a', true, true), sorted('b', true, true)], 'a', true)
    expect(clearDone(list).map((p) => p.id)).toEqual(['b'])
  })
})

describe('loading', () => {
  const store = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null })

  it('carries the old checklist over, unsorted, done ones still done', () => {
    const old = JSON.stringify([
      { id: '1', text: 'Charge the rig', done: false },
      { id: '2', text: 'Old thing', done: true },
      { nonsense: true },
    ])
    const list = loadPriorities(store({ [OLD_TODO_KEY]: old }), at(0))
    expect(list.map((p) => [p.text, groupOf(p)])).toEqual([
      ['Charge the rig', 'unsorted'],
      ['Old thing', 'done'],
    ])
  })

  it('prefers the saved priorities over the old checklist', () => {
    const saved = JSON.stringify([sorted('a', true, true)])
    const list = loadPriorities(store({ [PRIORITIES_KEY]: saved, [OLD_TODO_KEY]: '[{"id":"x","text":"y","done":false}]' }))
    expect(list.map((p) => p.id)).toEqual(['a'])
  })

  it('reads garbage and blocked storage as an empty list', () => {
    expect(loadPriorities(store({ [PRIORITIES_KEY]: '{not json' }))).toEqual([])
    expect(loadPriorities(null)).toEqual([])
    expect(
      loadPriorities({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toEqual([])
  })
})
