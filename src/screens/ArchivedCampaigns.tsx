// Campaigns he archived: still here, off every list. Restore brings one back
// with its accounts; Delete for good is the old delete, behind a confirmation
// (it is still a soft delete underneath - the history it carried stays).
//
// A campaign the cutter posts also carries its Postiz channels, which stay
// connected - and count against his plan - until he disables them. Archiving
// one lands here with that list open (?free=<id>); restoring one goes to its
// page with the reverse list (?postiz=restore).

import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { PostizChannels } from '../components/PostizChannels'
import { Button, Disclosure } from '../components/ui'
import { ScreenHeader } from '../components/ui'
import type { Campaign } from '../data'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { rememberedTodo } from '../sync/plannerPostiz'

export function ArchivedCampaigns() {
  const data = useData()
  const [archived, reload] = useLoaded(() => data.listArchivedCampaigns(), [data])
  const [sure, setSure] = useState<string | null>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(params.get('free') ? [params.get('free')!] : []))

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <ScreenHeader title="Archived" />
      {archived === null ? null : archived.length === 0 ? (
        <p className="text-base text-state-later">Nothing archived.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {archived.map((campaign) => (
            <li key={campaign.id} className="flex flex-col gap-2 py-4">
              <span className="script block break-words text-[1.75rem] leading-tight text-text">{campaign.name}</span>
              <span className="meta text-state-later">
                Archived {campaign.archived_at ? new Date(campaign.archived_at).toLocaleDateString() : ''}
              </span>
              {campaign.cutter_campaign_id ? (
                <ChannelsFold
                  campaign={campaign}
                  open={open.has(campaign.id)}
                  onOpenChange={(isOpen) =>
                    setOpen((current) => {
                      const next = new Set(current)
                      if (isOpen) next.add(campaign.id)
                      else next.delete(campaign.id)
                      return next
                    })
                  }
                />
              ) : null}
              {sure === campaign.id ? (
                <div className="settle-in flex flex-col gap-2 border-l-2 border-state-blocked pl-3">
                  <p className="text-base text-text">
                    Delete {campaign.name} for good? It can no longer be restored.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => setSure(null)} className="flex-1">
                      Keep it archived
                    </Button>
                    <Button
                      variant="blocked"
                      className="flex-1"
                      onClick={() => {
                        void data.deleteCampaign(campaign.id).then(async () => {
                          // A campaign deleted for good is no longer archived.
                          await data.updateCampaign(campaign.id, { archived_at: null })
                          setSure(null)
                          await reload()
                        })
                      }}
                    >
                      Delete for good
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      void data.restoreCampaign(campaign.id).then(() =>
                        // Back on its page, with the channels to switch on again.
                        campaign.cutter_campaign_id
                          ? navigate(`/campaigns/${campaign.id}?postiz=restore`)
                          : reload(),
                      )
                    }}
                  >
                    Restore
                  </Button>
                  <Button variant="quiet" className="flex-1" onClick={() => setSure(campaign.id)}>
                    Delete for good
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link to="/campaigns" className="meta text-state-later underline">
        Back to Briefs
      </Link>
    </section>
  )
}

/** The campaign's Postiz channels, folded. The fold says what the last check
 *  on this device found; opening it asks Postiz again. */
function ChannelsFold({
  campaign,
  open,
  onOpenChange,
}: {
  campaign: Campaign
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Seeded from the last check on this device, then kept current by the
  // panel's own checks.
  const [todo, setTodo] = useState(() => rememberedTodo(campaign.id))
  return (
    <Disclosure
      summary="Postiz channels"
      tone={todo !== null && todo > 0 ? 'now' : 'text'}
      trailing={todo === null ? 'not checked' : todo === 0 ? 'all switched off' : `${todo} still connected`}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="border-t"
    >
      {open ? <PostizChannels campaign={campaign} mode="free" onChecked={setTodo} /> : null}
    </Disclosure>
  )
}
