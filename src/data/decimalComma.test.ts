// Amounts typed with a decimal comma - what an iPhone's French keypad types,
// which has no "." - are read as the amount he meant, not a hundred times it.

import { describe, expect, it } from 'vitest'

import { parseDollarsToCents, plainNumber } from './campaignFields'
import { parseViews } from './viewsTracker'

describe('a decimal comma', () => {
  it('is sixteen fifty, not sixteen hundred and fifty', () => {
    expect(parseDollarsToCents('16,50')).toBe(1650)
    expect(parseDollarsToCents('16,5')).toBe(1650)
    expect(parseDollarsToCents('$16,50')).toBe(1650)
  })

  it('leaves thousands groups as thousands', () => {
    expect(parseDollarsToCents('1,650')).toBe(165000)
    expect(parseDollarsToCents('1,650.00')).toBe(165000)
    expect(parseDollarsToCents('1,200')).toBe(120000)
    expect(plainNumber('12,345,678')).toBe('12345678')
  })

  it('still refuses what is not an amount', () => {
    expect(parseDollarsToCents('16,500,00')).toBeNull()
    expect(parseDollarsToCents('1,65')).toBe(165)
    expect(parseDollarsToCents('abc')).toBeNull()
  })

  it('reads a minimum views the same way', () => {
    expect(parseViews('1,5k')).toBe(1500)
    expect(parseViews('1,500')).toBe(1500)
    expect(parseViews('1,000')).toBe(1000)
    expect(parseViews('2k')).toBe(2000)
  })
})
