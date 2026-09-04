import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { FieldValue } from '../components/FieldValue'
import { fieldLabel } from '../components/fieldLabel'
import type {
  BonusTier,
  Campaign as CampaignRow,
  CampaignAngle,
  CampaignField,
  CampaignRule,
} from '../data'
import { useData } from '../data/useData'

interface Loaded {
  campaign: CampaignRow
  fields: CampaignField[]
  angles: CampaignAngle[]
  rules: CampaignRule[]
  tiers: BonusTier[]
}

export function Campaign() {
  const { campaignId } = useParams()
  const data = useData()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    void (async () => {
      const campaign = await data.getCampaign(campaignId)
      if (!campaign) {
        if (!cancelled) setMissing(true)
        return
      }
      const [fields, angles, rules, tiers] = await Promise.all([
        data.listCampaignFields(campaignId),
        data.listCampaignAngles(campaignId),
        data.listCampaignRules(campaignId),
        data.listBonusTiers(campaignId),
      ])
      if (!cancelled) setLoaded({ campaign, fields, angles, rules, tiers })
    })()

    return () => {
      cancelled = true
    }
  }, [campaignId, data])

  if (missing) return <p className="text-state-later">No such campaign.</p>
  if (!loaded) return null

  const { campaign, fields, angles, rules, tiers } = loaded

  // The two sets are rendered from two queries against is_verified and are
  // never concatenated. Merging them would produce a list of eight angles that
  // no single source actually states.
  const verifiedAngles = angles.filter((a) => a.is_verified)
  const unverifiedAngles = angles.filter((a) => !a.is_verified)

  const sortedFields = [...fields].sort((a, b) => a.field_key.localeCompare(b.field_key))

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-text">{campaign.name}</h1>
        <p className="text-state-later">{campaign.company ?? 'company not saved yet'}</p>
      </header>

      {campaign.brief_is_incomplete ? (
        <p className="rounded-lg border border-state-waiting/40 bg-state-waiting/10 px-4 py-3 text-state-waiting">
          This brief looks incomplete. Some rules may be missing.
        </p>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-text">Pay</h2>
        <dl className="mt-2 flex flex-col gap-2">
          <Row label="pay per video">
            {campaign.pay_per_video_cents === null ? (
              <span className="text-state-later">not saved yet</span>
            ) : (
              <span className="text-text">{formatCents(campaign.pay_per_video_cents)}</span>
            )}
          </Row>
          <Row label="posts per payment cycle">
            {campaign.cycle_size === null ? (
              <span className="text-state-later">not saved yet</span>
            ) : (
              <span className="text-text">{campaign.cycle_size}</span>
            )}
          </Row>
          <Row label="opening balance (posts carried over)">
            <span className="text-text">{campaign.opening_post_count}</span>
          </Row>
          <Row label="posts owed per day">
            <span className="text-text">{campaign.daily_post_quota}</span>
          </Row>
        </dl>
      </div>

      {tiers.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-text">Bonuses</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {tiers.map((tier) => (
              <li key={tier.id} className="flex justify-between gap-4">
                <span className="text-state-later">{tier.label}</span>
                <span className="text-text">
                  {formatCents(tier.payout_cents)}
                  {tier.view_window_days === null
                    ? null
                    : ` - views within ${tier.view_window_days} days only`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-text">Angles</h2>
        <p className="mt-1 text-sm text-state-later">
          One angle per video. Never mix storylines.
        </p>

        {/* Two lists, each labelled by its own heading. They are built from
            two separate filters on is_verified and are never concatenated:
            the disagreement between the sources is information, and a merged
            list would destroy it. */}
        <h3
          id="angles-from-brief"
          className="mt-4 text-sm font-semibold uppercase tracking-wide text-state-later"
        >
          From the brief
        </h3>
        <ul aria-labelledby="angles-from-brief" className="mt-2 flex flex-col gap-3">
          {verifiedAngles.map((angle) => (
            <li key={angle.id}>
              <p className="font-semibold text-text">
                {angle.label}
                {angle.family === null ? null : (
                  <span className="ml-2 text-xs uppercase tracking-wide text-state-later">
                    {angle.family}
                  </span>
                )}
              </p>
              {angle.body === null ? null : (
                <p className="text-sm text-state-later">{angle.body}</p>
              )}
            </li>
          ))}
        </ul>

        {unverifiedAngles.length > 0 ? (
          <>
            <h3
              id="angles-from-skill-file"
              className="mt-6 text-sm font-semibold uppercase tracking-wide text-state-waiting"
            >
              From your skill file - not in the brief
            </h3>
            <p className="mt-1 text-sm text-state-waiting">
              The brief documents {verifiedAngles.length}. These {unverifiedAngles.length} appear
              in it only as product context, never as named angles. They are kept apart on purpose
              - there is no list of {verifiedAngles.length + unverifiedAngles.length}.
            </p>
            <ul aria-labelledby="angles-from-skill-file" className="mt-2 flex flex-col gap-3">
              {unverifiedAngles.map((angle) => (
                <li key={angle.id}>
                  <p className="font-semibold text-state-waiting">{angle.label}</p>
                  {angle.body === null ? null : (
                    <p className="text-sm text-state-later">{angle.body}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {rules.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-state-blocked">Never do</h2>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-5">
            {rules.map((rule) => (
              <li key={rule.id} className="text-state-blocked">
                {rule.body}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-text">Everything else</h2>
        <dl className="mt-2 flex flex-col gap-3">
          {sortedFields.map((field) => (
            <Row key={field.id} label={fieldLabel(field.field_key)}>
              <FieldValue field={field} />
            </Row>
          ))}
        </dl>
      </div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-state-later">{label}</dt>
      <dd className="text-base">{children}</dd>
    </div>
  )
}

/** Integer cents in, a readable figure out. No currency library, no floats in
 *  storage - the division happens here, at the edge, for display only. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
