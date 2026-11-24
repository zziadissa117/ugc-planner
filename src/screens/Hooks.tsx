// HOOKS - one place to write and generate hooks, opened from TODAY's single
// "Hook generation" button ("instead of having hooks for each and every
// campaign, just have a little section called Hooks"). Pick the campaign;
// the box and the list are the campaign page's own (CampaignIdeas), so a hook
// written here is the same hook there.

import { useState } from 'react'
import { Link } from 'react-router-dom'

import { CampaignIdeas } from '../components/CampaignIdeas'
import { buttonClass } from '../components/styles'
import { ScreenHeader } from '../components/ui'
import { byRecordingPriority } from '../data/campaignOrder'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'

export function Hooks() {
  const data = useData()
  const [campaigns] = useLoaded(async () => byRecordingPriority(await data.listCampaigns()), [data])
  const [chosen, setChosen] = useState<string | null>(null)
  const campaign = campaigns?.find((c) => c.id === chosen) ?? campaigns?.[0] ?? null
  const [fields, reloadFields] = useLoaded(async () => (campaign ? data.listCampaignFields(campaign.id) : []), [data, campaign?.id])

  if (campaigns === null) return null

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <ScreenHeader kicker="Hooks" title="Hook generation" />
      {campaign === null ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-base text-text-dim">No campaigns yet.</p>
          <Link to="/campaigns/new" className={buttonClass('now')}>
            Add a campaign
          </Link>
        </div>
      ) : (
        <>
          {campaigns.length > 1 ? (
            <div role="tablist" aria-label="Campaign" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {campaigns.map((c) => {
                const on = c.id === campaign.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setChosen(c.id)}
                    className={`press min-h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors duration-200 ${
                      on ? 'border-brand/60 bg-brand/15 text-text' : 'border-edge text-text-dim hover:border-edge-lit hover:text-text'
                    }`}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          ) : null}
          {fields === null ? null : (
            <CampaignIdeas
              key={campaign.id}
              campaign={campaign}
              ideasField={fields.find((f) => f.field_key === GENERATION_BRIEF_KEY)}
              onChanged={reloadFields}
            />
          )}
        </>
      )}
    </section>
  )
}
