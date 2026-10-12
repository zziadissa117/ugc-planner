import { describe, expect, it } from 'vitest'

import { MAX_ITEMS, SORT_DAY_SCHEMA, buildDayRequest, cleanSorted } from '../supabase/functions/_shared/dayPrompt'

describe('the sort-day prompt', () => {
  it("asks with his words and today's date", () => {
    const request = buildDayRequest('  buy a light  ', '2026-10-11')
    expect(request).toContain('Today is 2026-10-11.')
    expect(request).toContain('"""\nbuy a light\n"""')
  })

  it('requires every field, so the API holds the answer to the shape', () => {
    const item = (SORT_DAY_SCHEMA.properties as { items: { items: { required: string[] } } }).items.items
    expect(item.required).toEqual(['text', 'why', 'repeat', 'steps', 'deadline'])
  })

  it('keeps the answer within its limits: blanks dropped, repeats sane, list capped', () => {
    const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ text: `Task ${i}`, why: 'w', repeat: 'once', steps: [], deadline: null }))
    expect(cleanSorted({ items: many, skipped: [] }).items).toHaveLength(MAX_ITEMS)
    const cleaned = cleanSorted({
      items: [
        { text: '  ', why: '', repeat: 'once', steps: [], deadline: null },
        { text: 'Apply  on every app', why: 'money', repeat: 'weekly', steps: ['Gimi', ' ', 'Reddit'], deadline: '' },
      ],
      skipped: ['', 'Planner works fine'],
    })
    expect(cleaned).toEqual({
      items: [{ text: 'Apply on every app', why: 'money', repeat: 'once', steps: ['Gimi', 'Reddit'], deadline: null }],
      skipped: ['Planner works fine'],
    })
  })
})
