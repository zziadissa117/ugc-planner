// Product & hook ideas, and the hooks written from them, on the campaign page.
//
// One optional box: what the product is and any hook ideas he already has.
// It is the campaign's `generation_brief` field - the same text the FILM
// console shows as its creative brief - kept as he typed it and sent to the
// hook writer whole (buildContext in src/hooks/generateHooks.ts). Hooks are
// written the same way with the box empty, and with no angles at all.
//
// Under it, the campaign's hooks and the button that writes more. A generated
// hook says so on the hook itself; one he wrote never does.

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { Campaign, CampaignField } from '../data'
import { saveFieldValue } from '../data/campaignFields'
import { plainError } from '../data/errorText'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import {
  GENERATION_BRIEF_KEY,
  buildContext,
  generateHooks,
  hookGenerationAvailable,
  lastFamilyUsed,
  saveGeneratedHooks,
} from '../hooks/generateHooks'
import { CloseIcon, SparkIcon } from './icons'
import { CARD_CLASS, INPUT_CLASS } from './styles'
import { Button, SectionLabel } from './ui'

export function CampaignIdeas({
  campaign,
  ideasField,
  onChanged,
}: {
  campaign: Campaign
  /** The saved `generation_brief` row, if there is one. */
  ideasField: CampaignField | undefined
  onChanged: () => Promise<unknown> | void
}) {
  const data = useData()
  // TODAY's Hooks card links here as /campaigns/<id>#hooks. The router does
  // not scroll to a hash, and the section only exists once the campaign has
  // loaded, so it brings itself into view when it arrives.
  const { hash } = useLocation()
  const hooksSection = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (hash === '#hooks') hooksSection.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [hash])
  const [loadedHooks, reloadHooks] = useLoaded(() => data.listCampaignHooks(campaign.id), [campaign.id, data])
  // Newest first: a batch just written lands at the top, where he is looking.
  const hooks = [...(loadedHooks ?? [])].reverse()

  const saved = ideasField?.field_value ?? ''
  // Written by Claude when an old brief was read in, and never saved by him.
  // Saving it - as it is or changed - is what makes it his.
  const unreviewed = ideasField?.source === 'parsed_unreviewed'

  // Re-seeded whenever the saved text itself changes (another device saved
  // it, or this one just did), so the box never sits on a stale copy that a
  // Save would write back over the newer one.
  const seed = `${ideasField?.id ?? 'none'}:${ideasField?.updated_at ?? ''}`
  const [seededFrom, setSeededFrom] = useState(seed)
  const [draft, setDraft] = useState(saved)
  if (seededFrom !== seed) {
    setSeededFrom(seed)
    setDraft(saved)
  }

  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** One line about the batch, from what the app counted - never the
   *  generator's own account of itself. */
  const [note, setNote] = useState<string | null>(null)

  const changed = draft.trim() !== saved.trim()
  const dirty = changed || unreviewed

  async function saveIdeas() {
    await saveFieldValue(data, campaign.id, GENERATION_BRIEF_KEY, draft.trim() === '' ? null : draft)
    await onChanged()
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await saveIdeas()
      setJustSaved(true)
    } catch (caught) {
      setError(plainError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function generate() {
    setGenerating(true)
    setError(null)
    setNote(null)
    try {
      // What is in the box is what he means the hooks to come from, saved or
      // not - so an unsaved change goes in first.
      if (changed) await saveIdeas()
      const [fields, rules, angles, existing] = await Promise.all([
        data.listCampaignFields(campaign.id),
        data.listCampaignRules(campaign.id),
        data.listCampaignAngles(campaign.id),
        data.listCampaignHooks(campaign.id),
      ])
      const lastFamily = await lastFamilyUsed(data, campaign.id, angles)
      // A day's videos and a couple spare - his own number, not one picked
      // here - and never fewer than three.
      const asked = Math.max(3, campaign.daily_post_quota + 2)
      const result = await generateHooks(
        buildContext({ campaign, fields, rules, angles, hooks: existing, lastFamily, count: asked }),
      )
      const outcome = await saveGeneratedHooks(data, campaign.id, result)

      // Silence when he got what he asked for: the hooks are the answer.
      const parts: string[] = []
      if (outcome.saved < asked) parts.push(`${outcome.saved} of ${asked}`)
      if (outcome.duplicates > 0) {
        parts.push(`${outcome.duplicates} you already had ${outcome.duplicates === 1 ? 'was' : 'were'} skipped`)
      }
      setNote(parts.length > 0 ? parts.join(' - ') : null)
      await reloadHooks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setGenerating(false)
    }
  }

  async function remove(id: string) {
    await data.deleteCampaignHook(id)
    await reloadHooks()
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel trailing="optional">Product & hook ideas</SectionLabel>
        {unreviewed ? (
          <p className="meta text-state-waiting">
            Claude wrote this from your old brief and nothing in it has been checked. Saving makes it yours.
          </p>
        ) : null}
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setJustSaved(false)
          }}
          aria-label="Product and hook ideas"
          placeholder="What the product is, and any hooks you already have."
          className={`${INPUT_CLASS} min-h-40 w-full resize-y py-3 text-base leading-relaxed`}
        />
        <Button
          variant={dirty ? 'now' : 'quiet'}
          size="small"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="self-start"
        >
          {saving ? 'Saving...' : justSaved && !dirty ? 'Saved' : 'Save ideas'}
        </Button>
      </div>

      <div id="hooks" ref={hooksSection} className="flex scroll-mt-6 flex-col gap-3">
        <SectionLabel trailing={hooks.length > 0 ? hooks.length : undefined}>Hooks</SectionLabel>
        {loadedHooks === null ? null : hooks.length === 0 ? (
          <p className="text-base text-text-dim">No hooks yet.</p>
        ) : (
          <ul aria-label="Hooks" className={`${CARD_CLASS} flex flex-col divide-y divide-rule px-4`}>
            {hooks.map((hook) => (
              <li key={hook.id} className="flex items-start gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span
                    className={`block whitespace-pre-wrap text-base leading-snug ${
                      hook.used_at === null ? 'text-text' : 'text-state-later line-through decoration-state-later/60'
                    }`}
                  >
                    {hook.body}
                  </span>
                  {hook.source === 'generated' ? (
                    <span className="label mt-1.5 block text-state-later">generated</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(hook.id)}
                  aria-label={`Delete hook: ${hook.body.slice(0, 40)}`}
                  className="press -my-1 flex size-10 shrink-0 items-center justify-center rounded-full text-state-later transition-colors hover:bg-white/[0.04] hover:text-text"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {hookGenerationAvailable() ? (
          <div className="flex flex-col gap-2">
            <Button onClick={() => void generate()} disabled={generating} className="w-full">
              <SparkIcon className="h-5 w-5" />
              {generating ? 'Writing hooks...' : 'Write me some hooks'}
            </Button>
            {generating ? (
              // One request, no progress to report - so it says "working"
              // without pretending to know how far along it is.
              <div aria-hidden className="h-px overflow-hidden rounded-full bg-rule">
                <div className="indeterminate-bar h-full w-1/4 bg-brand" />
              </div>
            ) : null}
          </div>
        ) : null}

        {note === null ? null : <p className="meta text-state-later">{note}</p>}
        {error === null ? null : <p className="text-base text-state-blocked">{error}</p>}
      </div>
    </div>
  )
}
