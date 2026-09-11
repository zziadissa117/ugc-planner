import { describe, expect, it } from 'vitest'

import { sectionLines, stripMarker, talkingPointsFromBrief } from './briefSections'

const BRIEF = `# Vertus Campaign Brief

## PRODUCT
Vertus - an AI system at waitlist stage.
Never state a claim as fact.

## TALKING POINTS
- Vertus says it reasons instead of predicting
- Team came from aerospace, biotech and defense
- Reportedly tested in high-stakes places already
- Not launched yet, waitlist is open now
- Expanding past finance into other industries
- Built on a different architecture, they say

## FORMATS
A - The Receipt.
`

describe('reading a section out of the pasted brief', () => {
  it('takes the lines under the heading and stops at the next one', () => {
    expect(talkingPointsFromBrief(BRIEF)).toEqual([
      'Vertus says it reasons instead of predicting',
      'Team came from aerospace, biotech and defense',
      'Reportedly tested in high-stakes places already',
      'Not launched yet, waitlist is open now',
      'Expanding past finance into other industries',
      'Built on a different architecture, they say',
    ])
  })

  it('does not wander into the section after it', () => {
    expect(talkingPointsFromBrief(BRIEF)).not.toContain('A - The Receipt.')
  })

  it('finds the heading at any level and in any case', () => {
    expect(talkingPointsFromBrief('# Talking Points\n- One')).toEqual(['One'])
    expect(talkingPointsFromBrief('### talking points\n- One')).toEqual(['One'])
    expect(talkingPointsFromBrief('**TALKING POINTS**\n- One')).toEqual(['One'])
  })

  it('is empty when the document has no such section', () => {
    expect(talkingPointsFromBrief('## PRODUCT\nSomething.')).toEqual([])
    expect(talkingPointsFromBrief(null)).toEqual([])
    expect(talkingPointsFromBrief('   ')).toEqual([])
  })

  it('reads other sections by name too', () => {
    expect(sectionLines(BRIEF, 'product')).toEqual([
      'Vertus - an AI system at waitlist stage.',
      'Never state a claim as fact.',
    ])
  })
})

describe('tidying a pasted line', () => {
  it('drops bullets and numbers, keeps the words', () => {
    expect(stripMarker('- One thing')).toBe('One thing')
    expect(stripMarker('* One thing')).toBe('One thing')
    expect(stripMarker('• One thing')).toBe('One thing')
    expect(stripMarker('1. One thing')).toBe('One thing')
    expect(stripMarker('2) One thing')).toBe('One thing')
    expect(stripMarker('  One thing  ')).toBe('One thing')
  })

  it('leaves a hyphen that is part of the sentence alone', () => {
    expect(stripMarker('Paid out instantly - not in seven days')).toBe(
      'Paid out instantly - not in seven days',
    )
  })
})
