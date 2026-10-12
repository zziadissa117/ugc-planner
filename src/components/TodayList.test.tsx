// The day's list on the home screen: paste the dictation, get one list back,
// tick it down. The sorting call is mocked; the rules are in dayList.test.ts.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sortDay = vi.fn()
vi.mock('../dayPlan', async (original) => ({
  ...(await original<typeof import('../dayPlan')>()),
  sortDay: (text: string, today: string) => sortDay(text, today),
}))

import { SortDayError } from '../dayPlan'
import { TodayList } from './TodayList'

const ANSWER = {
  items: [
    { text: 'Apply for campaigns on every app', why: 'New campaigns = money', repeat: 'daily', steps: ['SideShift', 'Gimi'], deadline: null },
    { text: 'Warm up Vaza accounts', why: 'Posting Vaza tomorrow', repeat: 'once', steps: [], deadline: 'for tomorrow' },
  ],
  skipped: ['My planner and cutter work perfectly'],
  model: 'claude-sonnet-5-5',
}

beforeEach(() => {
  localStorage.clear()
  sortDay.mockReset()
})

async function pasteAndSort(text = 'apply everywhere, warm up vaza') {
  const user = userEvent.setup()
  render(<TodayList />)
  await user.type(screen.getByLabelText('Your dictation'), text)
  await user.click(screen.getByRole('button', { name: 'Sort it' }))
  return user
}

describe("today's list", () => {
  it('is just a paste box until something is sorted', () => {
    render(<TodayList />)
    expect(screen.getByLabelText('Your dictation')).toBeInTheDocument()
    expect(screen.queryByText(/of .* done/)).toBeNull()
  })

  it('sorts the dictation into one list, most important first, saying who sorted it', async () => {
    sortDay.mockResolvedValue(ANSWER)
    await pasteAndSort()
    expect(sortDay).toHaveBeenCalledWith('apply everywhere, warm up vaza', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    const list = screen.getByRole('list', { name: 'To do' })
    const rows = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list)
    expect(rows.map((r) => r.querySelector('p')?.textContent)).toEqual(['Apply for campaigns on every app', 'Warm up Vaza accounts'])
    expect(screen.getByText('every day · New campaigns = money')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 done')).toBeInTheDocument()
    expect(screen.getByText(/Sorted by Claude \(claude-sonnet-5-5\)/)).toBeInTheDocument()
  })

  it('ticks in one tap and the row stays where it is', async () => {
    sortDay.mockResolvedValue(ANSWER)
    const user = await pasteAndSort()
    await user.click(screen.getByRole('button', { name: 'Mark Warm up Vaza accounts done' }))
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Warm up Vaza accounts not done' })).toBeInTheDocument()
    expect(screen.getByText('Warm up Vaza accounts')).toBeInTheDocument()
  })

  it('ticks an item off when its last step is ticked', async () => {
    sortDay.mockResolvedValue(ANSWER)
    const user = await pasteAndSort()
    await user.click(screen.getByRole('button', { name: 'Mark SideShift done' }))
    await user.click(screen.getByRole('button', { name: 'Mark Gimi done' }))
    expect(screen.getByRole('button', { name: 'Mark Apply for campaigns on every app not done' })).toBeInTheDocument()
  })

  it('says why in words when it cannot sort, and keeps the text', async () => {
    sortDay.mockRejectedValue(new SortDayError('No API key saved. Add your Anthropic key in Setup first.'))
    await pasteAndSort('buy a light')
    expect(await screen.findByRole('alert')).toHaveTextContent('No API key saved. Add your Anthropic key in Setup first. Your text is kept.')
    expect(screen.getByLabelText('Your dictation')).toHaveValue('buy a light')
  })

  it('keeps the list after a reload', async () => {
    sortDay.mockResolvedValue(ANSWER)
    const { unmount } = render(<div />)
    unmount()
    await pasteAndSort()
    expect(JSON.parse(localStorage.getItem('ugc-planner.day-list')!).items).toHaveLength(2)
  })
})
