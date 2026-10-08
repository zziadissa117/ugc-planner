// The creative brief and his own hook ideas, in the FILM console.
//
// They used to sit on the campaign page, where he never looked: "if I want to
// film some hooks, I go to the film section, I press on the campaign, and if
// there's a brief, then that's where hooks are going to get generated". Most
// campaigns give him no creative freedom - the brand sends a video to copy -
// so this is folded away and says plainly when there is nothing in it.

import { useState } from 'react'

import type { CampaignField, CampaignHook } from '../data'
import { saveFieldValue } from '../data/campaignFields'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { CloseIcon } from './icons'
import { INPUT_CLASS } from './styles'
import { Button, Disclosure } from './ui'

export function CreativeBrief({
  campaignId,
  field,
  onChanged,
}: {
  campaignId: string
  /** The saved creative brief (`generation_brief`), if there is one. */
  field: CampaignField | undefined
  onChanged: () => Promise<unknown> | void
}) {
  const data = useData()
  const value = field?.field_value ?? ''
  const unreviewed = field?.source === 'parsed_unreviewed'

  return (
    <Disclosure
      summary="Creative brief"
      trailing={value.trim() === '' ? 'none' : unreviewed ? 'written by Claude, not checked' : 'saved'}
      className="border-t"
    >
      <div className="flex flex-col gap-4">
        {value.trim() === '' ? (
          <p className="text-base text-state-later">
            No creative brief - add one if this campaign gives you freedom. Hooks are still written from
            what the contract says.
          </p>
        ) : null}
        <GenerationBrief
          value={value}
          unreviewed={unreviewed}
          onSave={async (next) => {
            await saveFieldValue(data, campaignId, GENERATION_BRIEF_KEY, next)
            await onChanged()
          }}
        />
        <HooksEditor campaignId={campaignId} onChanged={onChanged} />
      </div>
    </Disclosure>
  )
}

/** A whole worked-up brief, pasted in as one document.
 *
 *  He does not write hooks by hand. He has the campaign's brief read and
 *  turned into a document - product facts, audience segments, voice rules,
 *  formats, hook banks, angles - and pastes the result in here (or the
 *  contract reader writes one, labelled as Claude's). It is stored verbatim as
 *  one field and sent to the generator whole, because the structure is the
 *  point: split into fragments it would be a pile of lines.
 *
 *  Deliberately NOT a list of hooks. Nothing here is ever offered to him as a
 *  line to read to camera. */
export function GenerationBrief({
  value,
  unreviewed,
  onSave,
}: {
  value: string
  /** Written by Claude when the documents were read, and not yet saved by
   *  him. Saving it - as is or edited - is what makes it his. */
  unreviewed: boolean
  onSave: (value: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = draft.trim() !== value.trim() || unreviewed

  return (
    <div className="flex flex-col gap-2">
      {unreviewed ? (
        <p className="meta text-state-waiting">
          Claude wrote this from your brief and nothing in it has been checked. Read it, fix what is
          wrong, then save - saving makes it yours.
        </p>
      ) : null}
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setSaved(false)
        }}
        aria-label="Brief for the hook writer"
        placeholder="Paste the brand's brief or your worked-up brief: product, audience, voice, formats, angles..."
        className={`${INPUT_CLASS} h-56 w-full resize-y py-3 font-mono text-sm`}
      />
      <Button
        onClick={() => {
          setBusy(true)
          void onSave(draft.trim() === '' ? null : draft)
            .then(() => setSaved(true))
            .finally(() => setBusy(false))
        }}
        disabled={busy || !dirty}
        className="w-full"
      >
        {busy ? 'Saving...' : saved && !dirty ? 'Saved' : unreviewed ? 'Looks right - save it' : 'Save the brief'}
      </Button>
    </div>
  )
}

/** Hooks, ideas, formats - whatever he wants the generator to work from. A
 *  blank line starts a new entry, so a whole page of ideas can be pasted in at
 *  once. */
export function HooksEditor({ campaignId, onChanged }: { campaignId: string; onChanged?: () => Promise<unknown> | void }) {
  const data = useData()
  const [loaded, reload] = useLoaded(() => data.listCampaignHooks(campaignId), [campaignId, data])
  const hooks: CampaignHook[] = loaded ?? []
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    // Split on blank lines rather than every newline: a rough idea is often
    // several lines, and one paste should not become twelve fragments.
    const entries = body
      .split(/\n\s*\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    if (entries.length === 0) return

    setBusy(true)
    try {
      for (const entry of entries) {
        await data.addCampaignHook({
          campaign_id: campaignId,
          angle_id: null,
          body: entry,
          outline: null,
          // His words. A model never wrote this, so it must not claim one did.
          source: 'user_entered',
          model: null,
          generated_at: null,
          used_at: null,
        })
      }
      setBody('')
      await reload()
      await onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await data.deleteCampaignHook(id)
    await reload()
    await onChanged?.()
  }

  return (
    <Disclosure summary={`Your hooks & ideas - ${hooks.length}`}>
      {hooks.length > 0 ? (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex items-start gap-2 py-2.5">
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap text-base ${
                  hook.used_at === null ? 'text-text' : 'text-state-later line-through'
                }`}
              >
                {hook.body}
                {hook.source === 'generated' ? <span className="ml-2 label text-state-later">generated</span> : null}
              </span>
              <button
                type="button"
                onClick={() => void remove(hook.id)}
                aria-label={`Delete hook: ${hook.body.slice(0, 40)}`}
                className="press -my-1 flex size-9 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-label="Hooks and ideas"
        placeholder="Dump hooks, video ideas, formats, concepts. Blank line between each. Write me some hooks builds from these."
        className={`${INPUT_CLASS} mt-3 h-28 w-full resize-y py-3 text-base`}
      />
      <Button onClick={() => void add()} disabled={busy || body.trim() === ''} className="mt-2 w-full">
        Save these ideas
      </Button>
    </Disclosure>
  )
}
