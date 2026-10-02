// Campaigns he archived: still here, off every list. Restore brings one back
// with its accounts; Delete for good is the old delete, behind a confirmation
// (it is still a soft delete underneath - the history it carried stays).

import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui'
import { ScreenHeader } from '../components/ui'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'

export function ArchivedCampaigns() {
  const data = useData()
  const [archived, reload] = useLoaded(() => data.listArchivedCampaigns(), [data])
  const [sure, setSure] = useState<string | null>(null)

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
                      void data.restoreCampaign(campaign.id).then(reload)
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
