// One campaign's views: the month so far, and each account's last 24 hours
// with a flag when it is under 100, 200 or 500. Opened from the chart button
// beside the campaign's name on the Post screen. Views are the cutter's own
// readings (src/data/campaignViews.ts), read only.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { BackIcon, PlatformGlyph } from '../components/icons'
import { buttonClass } from '../components/styles'
import { Card, ScreenHeader, SectionLabel } from '../components/ui'
import type { Campaign } from '../data'
import { cutterCampaignFor, readSince, summariseViews, viewFlag, type CampaignViews } from '../data/campaignViews'
import { useData } from '../data/useData'
import { fetchCutterViews, listCutterCampaigns } from '../sync/cutterViews'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-linked' }
  | { kind: 'ready'; views: CampaignViews }

const count = (n: number) => n.toLocaleString('en-US')

export function CampaignAnalytics() {
  const data = useData()
  const { campaignId } = useParams()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const found = campaignId ? await data.getCampaign(campaignId) : null
        if (cancelled) return
        setCampaign(found)
        if (!found) return
        const cutterCampaigns = found.cutter_campaign_id ? [] : await listCutterCampaigns()
        if (cutterCampaigns === null) {
          if (!cancelled) setState({ kind: 'error', message: 'Views are only available on your own account.' })
          return
        }
        const cutterId = cutterCampaignFor(found, cutterCampaigns)
        if (!cutterId) {
          if (!cancelled) setState({ kind: 'not-linked' })
          return
        }
        const now = new Date()
        const [posts, accounts] = await Promise.all([
          fetchCutterViews(cutterId, readSince(now)),
          data.listCampaignAccounts(found.id),
        ])
        if (cancelled) return
        // His accounts on this campaign: only their posts count, never Jake's.
        const mine = accounts.filter((a) => a.is_active).map((a) => ({ id: a.id, platform: a.platform, handle: a.handle }))
        setState(
          posts === null
            ? { kind: 'error', message: 'Views are only available on your own account.' }
            : { kind: 'ready', views: summariseViews(posts, mine, now) },
        )
      } catch (error) {
        if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [campaignId, data])

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link to="/post" className={`${buttonClass('ghost', 'small')} -ml-3 self-start`}>
        <BackIcon className="h-4 w-4" />
        Post
      </Link>
      <ScreenHeader kicker="Analytics" title={campaign?.name ?? 'Analytics'} meta="Your accounts' views, from the cutter's readings" />

      {state.kind === 'loading' ? <p className="text-base text-state-later">Reading views…</p> : null}
      {state.kind === 'error' ? <p className="text-base text-state-blocked">{state.message}</p> : null}
      {state.kind === 'not-linked' ? (
        <p className="text-base text-text-dim">
          No cutter campaign called {campaign?.name}, so there are no views to read for it.
        </p>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <Card className="flex flex-col gap-3 p-5">
            <p className="kicker">This month</p>
            <p className="numeric font-bold leading-none text-text" style={{ fontSize: 'clamp(2.75rem, 14vw, 4rem)' }}>
              {count(state.views.monthViews)}
            </p>
            <p className="meta text-state-later">
              views across {state.views.monthPosts} post{state.views.monthPosts === 1 ? '' : 's'}
              {state.views.monthUnread > 0 ? ` · ${state.views.monthUnread} not read yet` : ''}
            </p>
          </Card>

          <div className="flex flex-col gap-3">
            <SectionLabel>Last 24 hours</SectionLabel>
            {state.views.accounts.length === 0 ? (
              <p className="text-base text-text-dim">No accounts on this campaign yet. Add them on the campaign.</p>
            ) : (
              <Card className="overflow-hidden">
                <ul className="flex flex-col divide-y divide-rule">
                  {state.views.accounts.map((account) => {
                    const flag = viewFlag(account.last24)
                    return (
                      <li key={account.key} className="flex flex-col gap-1.5 px-4 py-3.5 sm:px-5">
                        <span className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <PlatformGlyph platform={account.platform} className="h-5 w-5 shrink-0 text-text-dim" />
                            <span className="flex min-w-0 flex-col">
                              <span className="text-base font-semibold text-text">{account.platform}</span>
                              <span className="meta min-w-0 truncate text-state-later">{account.label ?? 'no handle saved'}</span>
                            </span>
                          </span>
                          <span
                            className={`numeric shrink-0 text-lg font-semibold ${account.last24 === null ? 'text-state-later' : 'text-text'}`}
                          >
                            {account.label === null
                              ? 'add its handle'
                              : account.last24 === null
                                ? account.posts === 0
                                  ? 'no post'
                                  : 'not read yet'
                                : `${count(account.last24)} views`}
                          </span>
                        </span>
                        {flag !== null ? (
                          <p className="text-sm text-state-waiting">
                            In the past 24 hours, we had less than {flag} views for this account.
                          </p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
