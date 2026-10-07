// Priorities, on the Setup screen: the small things that are not a campaign
// deliverable - charge the rig, answer the brand, set up an account - sorted
// so the ones that matter get done first. The rules, and the research they
// come from, are in src/priorities.ts.
//
// A new line lands in "Sort these" and asks two questions, importance first.
// The answers put it in a group; the important ones go up onto Today, which
// holds three, worked from the top. The top one is "do this now" - the one
// bright white thing on the list.

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
  const full = todayIsFull(list)
  const row = { matchFor, onChange: setList, full }

  return (
    <div className="flex flex-col gap-4">
      {/* Grey, not amber: a count of what is left is not a state. */}
      <SectionLabel
        trailing={groups.today.length === 0 ? undefined : `${groups.today.length} on today`}
      >
        Priorities
      </SectionLabel>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="e.g. Charge the phone rig"
          aria-label="Add a priority"
          className={`${INPUT_CLASS} min-w-0 flex-1`}
        />
        <Button onClick={submit} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      {groups.unsorted.length > 0 ? (
        <Section title="Sort these" hint="Two questions each. Importance first, so the loud ones don't win by default.">
          {groups.unsorted.map((p) => (
            <SortRow key={p.id} item={p} {...row} />
          ))}
        </Section>
      ) : null}

      <Section
        title="Today"
        trailing={`${groups.today.length} of ${TODAY_LIMIT}`}
        hint={
          groups.today.length === 0
            ? 'Nothing on Today. Put up to three on it, the important ones first, and work from the top.'
            : 'Finish the top one before the next. Anything left stays here for tomorrow.'
        }
      >
        {groups.today.map((p) => (
          <TodayRow key={p.id} item={p} {...row} />
        ))}
      </Section>

      {groups.doFirst.length > 0 ? (
        <Section title="Important and soon" hint="Do these first: put them on Today.">
          {groups.doFirst.map((p) => (
            <GroupRow key={p.id} item={p} {...row} />
          ))}
        </Section>
      ) : null}

      {groups.plan.length > 0 ? (
        <Section title="Important, not urgent" hint="These are the ones that slip. Give each a when, so it happens.">
          {groups.plan.map((p) => (
            <GroupRow key={p.id} item={p} withWhen {...row} />
          ))}
        </Section>
      ) : null}

      {groups.batch.length > 0 ? (
        <Section title="Urgent, not important" hint="Do the quick ones together in one sitting, not between the work that matters.">
          {groups.batch.map((p) => (
            <GroupRow key={p.id} item={p} {...row} />
          ))}
        </Section>
      ) : null}

      {groups.drop.length > 0 ? (
        <Disclosure summary={`Neither - drop these? (${groups.drop.length})`} className="border-t">
          <ul className="flex flex-col divide-y divide-rule">
            {groups.drop.map((p) => (
              <GroupRow key={p.id} item={p} {...row} />
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {groups.done.length > 0 ? (
        <Disclosure summary={`Done (${groups.done.length})`} className="border-t">
          <ul className="flex flex-col divide-y divide-rule">
            {groups.done.map((p) => (
              <li key={p.id} className="flex min-h-tap items-center gap-3 py-1.5">
                <Tick item={p} onChange={setList} />
                <span className="min-w-0 flex-1 text-base text-state-later line-through">{p.text}</span>
                <RemoveButton item={p} onChange={setList} />
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="small" className="mt-2" onClick={() => setList((current) => clearDone(current))}>
            Clear done
          </Button>
        </Disclosure>
      ) : null}
    </div>
  )
}

type RowProps = {
  item: Priority
  matchFor: (text: string) => Campaign | null
  onChange: (change: (current: Priority[]) => Priority[]) => void
  full: boolean
}

function Section({
  title,
  trailing,
  hint,
  children,
}: {
  title: string
  trailing?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel as="h3" trailing={trailing}>
        {title}
      </SectionLabel>
      {hint ? <p className="meta text-state-later">{hint}</p> : null}
      <ul className="flex flex-col divide-y divide-rule">{children}</ul>
    </div>
  )
}

function SortRow({ item, matchFor, onChange }: RowProps) {
  const asking = item.important === null ? 'important' : 'urgent'
  const question =
    asking === 'important' ? 'Does it move a campaign or money forward?' : 'Does it have to happen in the next day or two?'
  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center gap-3">
        <StateDot tone="later" />
        <span className="min-w-0 flex-1 text-base text-text">{item.text}</span>
        <CampaignLink campaign={matchFor(item.text)} />
        <RemoveButton item={item} onChange={onChange} />
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5">
        <span className="meta text-state-later">{question}</span>
        <Button size="small" aria-label={`${item.text}: yes`} onClick={() => onChange((c) => answer(c, item.id, asking, true))}>
          Yes
        </Button>
        <Button size="small" aria-label={`${item.text}: no`} onClick={() => onChange((c) => answer(c, item.id, asking, false))}>
          No
        </Button>
      </div>
    </li>
  )
}

function TodayRow({ item, matchFor, onChange }: RowProps) {
  const top = item.rank === 1
  return (
    <li className="flex min-h-tap items-center gap-3 py-1.5">
      <Tick item={item} onChange={onChange} />
      <span className="min-w-0 flex-1">
        <span className={`block text-base ${top ? 'font-semibold text-state-now' : 'text-text'}`}>{item.text}</span>
        <span className="meta block text-state-later">
          {top ? 'Do this now' : `Then, number ${item.rank}`}
          {item.when ? ` - ${item.when}` : ''}
        </span>
      </span>
      <CampaignLink campaign={matchFor(item.text)} />
      {!top ? (
        <button
          type="button"
          aria-label={`Move ${item.text} up`}
          onClick={() => onChange((c) => moveUp(c, item.id))}
          className="press flex size-10 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
        >
          <ChevronDownIcon className="h-4 w-4 rotate-180" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Take ${item.text} off Today`}
        onClick={() => onChange((c) => takeOffToday(c, item.id))}
        className="press -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </li>
  )
}

function GroupRow({ item, matchFor, onChange, full, withWhen = false }: RowProps & { withWhen?: boolean }) {
  const [when, setWhenDraft] = useState(item.when ?? '')
  return (
    <li className="flex flex-col gap-1.5 py-1.5">
      <div className="flex min-h-tap items-center gap-3">
        <Tick item={item} onChange={onChange} />
        <span className="min-w-0 flex-1 text-base text-text">{item.text}</span>
        <CampaignLink campaign={matchFor(item.text)} />
        <Button
          size="small"
          disabled={full}
          aria-label={`Put ${item.text} on Today`}
          title={full ? `Today already has ${TODAY_LIMIT}. Finish one or take one off.` : undefined}
          onClick={() => onChange((c) => putOnToday(c, item.id))}
        >
          Today
        </Button>
        <RemoveButton item={item} onChange={onChange} />
      </div>
      {withWhen ? (
        <input
          value={when}
          onChange={(event) => setWhenDraft(event.target.value)}
          onBlur={() => onChange((c) => setWhen(c, item.id, when))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          placeholder="When and where? e.g. Sunday 10am at the desk"
          aria-label={`When for ${item.text}`}
          className={`${INPUT_CLASS} ml-9 min-h-10 text-sm`}
        />
      ) : null}
      <button
        type="button"
        onClick={() => onChange((c) => resort(c, item.id))}
        className="meta self-start pl-9 text-state-later underline-offset-2 hover:underline"
      >
        Sort again
      </button>
    </li>
  )
}

function Tick({ item, onChange }: { item: Priority; onChange: RowProps['onChange'] }) {
  return (
    <button
      type="button"
      aria-label={`Mark ${item.text} ${item.done ? 'not done' : 'done'}`}
      onClick={() => onChange((c) => setDone(c, item.id, !item.done))}
      className="press -m-2 flex size-11 shrink-0 items-center justify-center"
    >
      <span
        className={`flex size-6 items-center justify-center rounded-full border ${
          item.done ? 'border-state-posted text-state-posted' : 'border-edge-lit'
        }`}
      >
        {item.done ? <CheckIcon className="draw-check h-4 w-4" strokeWidth={2.25} /> : null}
      </span>
    </button>
  )
}

function RemoveButton({ item, onChange }: { item: Priority; onChange: RowProps['onChange'] }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${item.text}`}
      onClick={() => onChange((c) => remove(c, item.id))}
      className="press -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
    >
      <CloseIcon className="h-4 w-4" />
    </button>
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
