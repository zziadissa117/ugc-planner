import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useLoaded } from './useLoaded'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useLoaded', () => {
  it('is null until the first read lands, then holds it', async () => {
    const { result } = renderHook(() => useLoaded(async () => 'rows', []))
    expect(result.current[0]).toBeNull()
    await waitFor(() => expect(result.current[0]).toBe('rows'))
  })

  it('reads again on reload', async () => {
    let count = 0
    const { result } = renderHook(() => useLoaded(async () => ++count, []))
    await waitFor(() => expect(result.current[0]).toBe(1))
    await act(() => result.current[1]())
    expect(result.current[0]).toBe(2)
  })

  it('never lets an older read overwrite a newer one', async () => {
    // Two quick taps: two reloads in flight, the first finishing last.
    const reads = [deferred<string>(), deferred<string>(), deferred<string>()]
    let call = 0
    const { result } = renderHook(() => useLoaded(() => reads[call++].promise, []))

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current[1]()
      second = result.current[1]()
    })
    await act(async () => {
      reads[2].resolve('after the second tap')
      await second
      reads[1].resolve('after the first tap')
      await first
      reads[0].resolve('on mount')
    })

    expect(result.current[0]).toBe('after the second tap')
  })
})
