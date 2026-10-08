// Priorities, on the Setup screen: the small things that are not a campaign
// deliverable - charge the rig, answer the brand, set up an account - sorted
// so the ones that matter get done first. The rules, and the research they
// come from, are in src/priorities.ts.
//
// A new line lands in "Sort these" and asks two questions, importance first.
// The answers put it in a group; the important ones go up onto Today, which
// holds three, worked from the top. The top one is "do this now" - the one
// bright white thing on the list.
//
// Big and bare by design: he asked for less on screen and the work bigger.
// What he does every day - tick, sort, put on Today - is always there and
// large. What he does rarely - remove, sort again, reorder, take off Today -
// sits behind one Edit button rather than on every row. (Not behind hover:
// index.css keeps every affordance visible at rest.)

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { CheckIcon, ChevronDownIcon, CloseIcon } from '../components/icons'
import { INPUT_CLASS } from '../components/styles'
import { Button, Disclosure, SectionLabel, StateDot } from '../components/ui'
import type { Campaign } from '../data'
import {
  PRIORITIES_KEY,
  TODAY_LIMIT,
  add,
  answer,
  arrange,
  clearDone,
  loadPriorities,
  moveUp,
  putOnToday,
  remove,
  resort,
  setDone,
  setWhen,
  takeOffToday,
  todayIsFull,
  type Priority,
} from '../priorities'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function Priorities({ campaigns }: { campaigns: Campaign[] }) {
  const [list, setList] = useState<Priority[]>(() => loadPriorities(storage()))
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    try {
      storage()?.setItem(PRIORITIES_KEY, JSON.stringify(list))
    } catch {
      // Private browsing or full storage: the list still works for this visit.
    }
  }, [list])

  /** The campaign a line names, if any, so it can jump to that brief. Longest
   *  name first, so "Inflow" cannot take a line about "Inflow Canada". */
  const matchFor = useCallback(
    (text: string): Campaign | null => {
      const lower = text.toLowerCase()
      const byLength = [...campaigns].sort((a, b) => b.name.length - a.name.length)
      return byLength.find((c) => c.name.trim() !== '' && lower.includes(c.name.toLowerCase())) ?? null
    },
    [campaigns],
  )

  const submit = () => {
    if (!draft.trim()) return
    setList((current) => add(current, draft))
    setDraft('')
  }

  const groups = arrange(list)
  const row = { matchFor, onChange: setList, full: todayIsFull(list), editing }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <SectionLabel>Priorities</SectionLabel>
        </div>
        <Button variant="ghost" size="small" aria-pressed={editing} onClick={() => setEditing((on) => !on)}>
          {editing ? 'Done editing' : 'Edit'}
        </Button>
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="e.g. Charge the phone rig"
          aria-label="Add a priority"
          className={`${INPUT_CLASS} min-h-14 min-w-0 flex-1 text-lg`}
        />
        <Button onClick={submit} disabled={!draft.trim()} className="min-h-14 px-6 text-lg">
          Add
        </Button>
      </div>

      {groups.unsorted.length > 0 ? (
        <Section title="Sort these">
          {groups.unsorted.map((p) => (
            <SortRow key={p.id} item={p} {...row} />
          ))}
        </Section>
      ) : null}

      <Section title="Today" trailing={`${groups.today.length} of ${TODAY_LIMIT}`}>
        {groups.today.length === 0 ? (
          <li className="py-3 text-lg text-state-later">Nothing on Today yet.</li>
        ) : (
          groups.today.map((p) => <TodayRow key={p.id} item={p} {...row} />)
        )}
      </Section>

      {groups.doFirst.length > 0 ? (
        <Section title="Important and soon">
          {groups.doFirst.map((p) => (
            <GroupRow key={p.id} item={p} {...row} />
          ))}
        </Section>
      ) : null}

      {groups.plan.length > 0 ? (
        <Section title="Important, not urgent">
          {groups.plan.map((p) => (
            <GroupRow key={p.id} item={p} withWhen {...row} />
          ))}
        </Section>
      ) : null}

      {groups.batch.length > 0 ? (
        <Section title="Urgent, not important">
          {groups.batch.map((p) => (
            <GroupRow key={p.id} item={p} {...row} />
          ))}
        </Section>
      ) : null}

      {groups.drop.length > 0 || groups.done.length > 0 ? (
        <div className="flex flex-col">
          {groups.drop.length > 0 ? (
            <Disclosure summary="Not worth doing now" trailing={String(groups.drop.length)} className="border-t">
              <ul className="flex flex-col divide-y divide-rule">
                {groups.drop.map((p) => (
                  <GroupRow key={p.id} item={p} {...row} editing />
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {groups.done.length > 0 ? (
            <Disclosure summary="Done" trailing={String(groups.done.length)} className={groups.drop.length > 0 ? '' : 'border-t'}>
              <ul className="flex flex-col divide-y divide-rule">
                {groups.done.map((p) => (
                  <li key={p.id} className="flex min-h-tap items-center gap-3 py-1.5">
                    <Tick item={p} onChange={setList} />
                    <span className="min-w-0 flex-1 text-base text-state-later line-through">{p.text}</span>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="small" className="mt-2" onClick={() => setList((current) => clearDone(current))}>
                Clear done
              </Button>
            </Disclosure>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type RowProps = {
  item: Priority
  matchFor: (text: string) => Campaign | null
  onChange: (change: (current: Priority[]) => Priority[]) => void
  full: boolean
  editing: boolean
}

function Section({ title, trailing, children }: { title: string; trailing?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel as="h3" trailing={trailing}>
        {title}
      </SectionLabel>
      <ul className="flex flex-col divide-y divide-rule">{children}</ul>
    </div>
  )
}

function SortRow({ item, matchFor, onChange, editing }: RowProps) {
  const asking = item.important === null ? 'important' : 'urgent'
  const question =
    asking === 'important' ? 'Does it move a campaign or money forward?' : 'Does it have to happen in the next day or two?'
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-3">
        <StateDot tone="later" />
        <span className="min-w-0 flex-1 text-xl text-text">{item.text}</span>
        <CampaignLink campaign={matchFor(item.text)} />
        {editing ? <RemoveButton item={item} onChange={onChange} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 pl-5">
        <span className="text-base text-text-dim">{question}</span>
        <Button aria-label={`${item.text}: yes`} onClick={() => onChange((c) => answer(c, item.id, asking, true))}>
          Yes
        </Button>
        <Button aria-label={`${item.text}: no`} onClick={() => onChange((c) => answer(c, item.id, asking, false))}>
          No
        </Button>
      </div>
    </li>
  )
}

function TodayRow({ item, matchFor, onChange, editing }: RowProps) {
  const top = item.rank === 1
  return (
    <li className={`flex items-center gap-4 ${top ? 'py-4' : 'py-3'}`}>
      <Tick item={item} onChange={onChange} big={top} />
      <span className="min-w-0 flex-1">
        <span className={`block ${top ? 'text-2xl font-semibold text-state-now' : 'text-xl text-text'}`}>{item.text}</span>
        {top || item.when ? (
          <span className="block text-base text-state-later">
            {top ? 'Do this now' : ''}
            {top && item.when ? ' - ' : ''}
            {item.when ?? ''}
          </span>
        ) : null}
      </span>
      <CampaignLink campaign={matchFor(item.text)} />
      {editing && !top ? (
        <IconButton label={`Move ${item.text} up`} onClick={() => onChange((c) => moveUp(c, item.id))}>
          <ChevronDownIcon className="h-5 w-5 rotate-180" />
        </IconButton>
      ) : null}
      {editing ? (
        <IconButton label={`Take ${item.text} off Today`} onClick={() => onChange((c) => takeOffToday(c, item.id))}>
          <CloseIcon className="h-5 w-5" />
        </IconButton>
      ) : null}
    </li>
  )
}

function GroupRow({ item, matchFor, onChange, full, editing, withWhen = false }: RowProps & { withWhen?: boolean }) {
  const [when, setWhenDraft] = useState(item.when ?? '')
  const [writingWhen, setWritingWhen] = useState(false)
  const showWhenBox = withWhen && (writingWhen || (editing && item.when !== undefined))
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-4">
        <Tick item={item} onChange={onChange} />
        <span className="min-w-0 flex-1">
          <span className="block text-xl text-text">{item.text}</span>
          {withWhen && item.when && !showWhenBox ? (
            <span className="block text-base text-state-later">{item.when}</span>
          ) : null}
        </span>
        <CampaignLink campaign={matchFor(item.text)} />
        {withWhen && !item.when && !writingWhen ? (
          <Button variant="ghost" size="small" aria-label={`Add a when for ${item.text}`} onClick={() => setWritingWhen(true)}>
            + When
          </Button>
        ) : null}
        <Button
          disabled={full}
          aria-label={`Put ${item.text} on Today`}
          title={full ? `Today already has ${TODAY_LIMIT}. Finish one or take one off.` : undefined}
          onClick={() => onChange((c) => putOnToday(c, item.id))}
        >
          Today
        </Button>
        {editing ? <RemoveButton item={item} onChange={onChange} /> : null}
      </div>
      {showWhenBox ? (
        <input
          autoFocus={writingWhen}
          value={when}
          onChange={(event) => setWhenDraft(event.target.value)}
          onBlur={() => {
            onChange((c) => setWhen(c, item.id, when))
            setWritingWhen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          placeholder="When and where? e.g. Sunday 10am at the desk"
          aria-label={`When for ${item.text}`}
          className={`${INPUT_CLASS} ml-11 text-base`}
        />
      ) : null}
      {editing ? (
        <button
          type="button"
          onClick={() => onChange((c) => resort(c, item.id))}
          className="self-start pl-11 text-base text-state-later underline-offset-2 hover:underline"
        >
          Sort again
        </button>
      ) : null}
    </li>
  )
}

function Tick({ item, onChange, big = false }: { item: Priority; onChange: RowProps['onChange']; big?: boolean }) {
  return (
    <button
      type="button"
      aria-label={`Mark ${item.text} ${item.done ? 'not done' : 'done'}`}
      onClick={() => onChange((c) => setDone(c, item.id, !item.done))}
      className="press -m-2 flex size-12 shrink-0 items-center justify-center"
    >
      <span
        className={`flex items-center justify-center rounded-full border ${big ? 'size-8 border-state-now/80' : 'size-7'} ${
          item.done ? 'border-state-posted text-state-posted' : big ? '' : 'border-edge-lit'
        }`}
      >
        {item.done ? <CheckIcon className="draw-check h-5 w-5" strokeWidth={2.25} /> : null}
      </span>
    </button>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press flex size-11 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
    >
      {children}
    </button>
  )
}

function RemoveButton({ item, onChange }: { item: Priority; onChange: RowProps['onChange'] }) {
  return (
    <IconButton label={`Remove ${item.text}`} onClick={() => onChange((c) => remove(c, item.id))}>
      <CloseIcon className="h-5 w-5" />
    </IconButton>
  )
}

function CampaignLink({ campaign }: { campaign: Campaign | null }) {
  if (!campaign) return null
  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      aria-label={`Open the brief for ${campaign.name}`}
      className="press shrink-0 rounded-full border border-edge px-3 py-1 text-sm font-semibold text-text-dim active:bg-surface"
    >
      {campaign.name}
    </Link>
  )
}
