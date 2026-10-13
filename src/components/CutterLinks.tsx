// "Link to the Cutter": planner campaigns the cutter has one with the same
// name, each a one-tap link he confirms - never linked on a name by itself
// (src/data/cutterBridge.ts suggestCutterLinks). A linked campaign's Post
// boxes turn blue while the cutter has them scheduled, and tick themselves
// when they go out.
//
// Only for the user the bridge is on for: for anyone else listCutterCampaigns
// answers null and this shows nothing.

import { useEffect, useState } from 'react'

import { suggestCutterLinks } from '../data/cutterBridge'
import { listCutterCampaigns, type CutterCampaign } from '../sync/cutterBridge'
import { Button, SectionLabel } from './ui'

const DISMISSED_KEY = 'cutter-link-dismissed'

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function writeDismissed(set: ReadonlySet<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]))
  } catch {
    /* only hides it for this visit */
  }
}

export function CutterLinks({
  campaigns,
  onLink,
}: {
  campaigns: readonly { id: string; name: string; cutter_campaign_id: string | null; archived_at?: string | null }[]
  onLink: (campaignId: string, cutterId: string) => Promise<void>
}) {
  const [cutter, setCutter] = useState<CutterCampaign[] | null>(null)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listCutterCampaigns()
      .then((list) => !cancelled && setCutter(list))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (cutter === null) return null
  const suggestions = suggestCutterLinks(campaigns, cutter, dismissed)
  if (suggestions.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel trailing="its posts show here by themselves">Link to the Cutter</SectionLabel>
      <ul className="flex flex-col divide-y divide-rule">
        {suggestions.map((s) => (
          <li key={s.campaignId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
            <span className="min-w-0 flex-1 text-base text-text">
              {s.campaignName} <span className="text-state-later">↔ the Cutter's {s.cutterName}</span>
            </span>
            <Button
              size="small"
              variant="now"
              disabled={busy !== null}
              onClick={() => {
                setBusy(s.campaignId)
                void onLink(s.campaignId, s.cutterId).finally(() => setBusy(null))
              }}
            >
              {busy === s.campaignId ? 'Linking…' : 'Link'}
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                const next = new Set(dismissed).add(`${s.campaignId}:${s.cutterId}`)
                setDismissed(next)
                writeDismissed(next)
              }}
            >
              Not this
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
