// Freeing a finished campaign's Postiz channels, or switching them back on.
//
// His Postiz plan counts connected channels, and nothing here can disable
// one - Postiz's API only offers deleting an account for good, scheduled
// posts and all. So this is a guided list: each account the campaign posts
// to, what it needs from him, Open Postiz, and Check again to see it done.
// Owner only; for anyone else it renders nothing.

import { useCallback, useEffect, useState } from 'react'

import type { Campaign } from '../data'
import { useData } from '../data/useData'
import { channelSummary, type ChannelMode, type ChannelSummary } from '../postizChannels'
import { channelLimit, postizChannels, rememberTodo, saveChannelLimit } from '../sync/plannerPostiz'
import { INPUT_CLASS, buttonClass } from './styles'
import { Button, SectionLabel, StateDot } from './ui'

/** Where his channels are switched on and off. */
export const POSTIZ_APP_URL = 'https://platform.postiz.com/launches'

type Check =
  | { status: 'checking' }
  | { status: 'off' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; summary: ChannelSummary }

export function PostizChannels({
  campaign,
  mode,
  onChecked,
}: {
  campaign: Campaign
  mode: ChannelMode
  /** How many accounts are left to change, after each check. */
  onChecked?: (todo: number) => void
}) {
  const data = useData()
  const [check, setCheck] = useState<Check>({ status: 'checking' })
  const [limitText, setLimitText] = useState(() => String(channelLimit()))
  const limit = /^\d+$/.test(limitText) && Number(limitText) > 0 ? Number(limitText) : channelLimit()
  const cutterId = campaign.cutter_campaign_id

  // What one check finds. Returns the state rather than setting it, so the
  // effect and the button share it and only ever set state once it answers.
  const load = useCallback(async (): Promise<Check> => {
    if (!cutterId) return { status: 'off' }
    try {
      const [profiles, live] = await Promise.all([postizChannels(cutterId), data.listCampaigns()])
      if (profiles === null) return { status: 'off' }
      // Live = linked to a planner campaign that is not archived. An account
      // one of those still posts to is never one to switch off.
      const liveIds = new Set(
        live
          .filter((c) => c.id !== campaign.id && c.archived_at === null)
          .map((c) => c.cutter_campaign_id)
          .filter((id): id is string => Boolean(id)),
      )
      const summary = channelSummary(profiles, mode, liveIds)
      if (mode === 'free') rememberTodo(campaign.id, summary.todo)
      onChecked?.(summary.todo)
      return { status: 'ready', summary }
    } catch (caught) {
      return { status: 'failed', message: caught instanceof Error ? caught.message : String(caught) }
    }
  }, [campaign.id, cutterId, data, mode, onChecked])

  useEffect(() => {
    let cancelled = false
    void load().then((next) => {
      if (!cancelled) setCheck(next)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  if (!cutterId || check.status === 'off') return null

  const summary = check.status === 'ready' ? check.summary : null
  const heading = mode === 'free' ? 'Free its Postiz channels' : 'Switch its Postiz channels back on'

  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <SectionLabel
        tone={summary && summary.todo > 0 ? 'now' : 'later'}
        trailing={summary?.inUse != null ? `Channels in use: ${summary.inUse} of ${limit}` : undefined}
      >
        {heading}
      </SectionLabel>

      {check.status === 'checking' ? <p className="meta text-state-later">Asking Postiz...</p> : null}
      {check.status === 'failed' ? <p className="text-base text-state-blocked">{check.message}</p> : null}

      {summary ? (
        <>
          {summary.rows.length === 0 && summary.errors.length === 0 ? (
            <p className="text-base text-state-later">The cutter has no Postiz accounts set up for this campaign.</p>
          ) : null}

          {summary.rows.length > 0 ? (
            <ul aria-label="Postiz accounts" className="flex flex-col divide-y divide-rule border-y border-rule">
              {summary.rows.map((row) => (
                <li key={row.id} className="flex items-start gap-3 py-2.5">
                  <StateDot tone={row.tone} className="mt-2" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-base text-text">
                      {row.name || row.id}
                      {row.profile ? <span className="text-state-later"> {row.profile}</span> : null}
                    </span>
                    <span className="meta text-state-later">
                      {row.platform}
                      {row.note ? ` - ${row.note}` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm ${row.tone === 'now' ? 'text-state-now' : 'text-state-later'}`}>
                    {row.state}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {summary.errors.map((message) => (
            <p key={message} className="text-base text-state-blocked">
              {message}
            </p>
          ))}

          {summary.atRisk > 0 ? (
            <p className="border-l-2 border-state-blocked pl-3 text-base text-state-blocked">
              {summary.atRisk} {summary.atRisk === 1 ? 'post is' : 'posts are'} still due on these. Disabling them
              now makes {summary.atRisk === 1 ? 'it' : 'them'} fail - unschedule {summary.atRisk === 1 ? 'it' : 'them'}{' '}
              in the cutter first.
            </p>
          ) : null}

          <p className="meta text-state-later">
            {summary.todo === 0
              ? mode === 'free'
                ? 'Nothing left to switch off.'
                : 'Every account is connected.'
              : mode === 'free'
                ? "The app can't switch a channel off for you. In Postiz, open each white account's menu and disable the channel, then check again here."
                : "In Postiz, open each white account's menu and enable the channel, then check again here."}
          </p>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <a href={POSTIZ_APP_URL} target="_blank" rel="noreferrer" className={buttonClass(summary?.todo ? 'now' : 'quiet', 'small')}>
          Open Postiz
        </a>
        <Button
          size="small"
          onClick={() => {
            setCheck({ status: 'checking' })
            void load().then(setCheck)
          }}
          disabled={check.status === 'checking'}
        >
          Check again
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm text-state-later">
          Channels on your plan
          <input
            value={limitText}
            onChange={(event) => {
              setLimitText(event.target.value)
              const next = Number(event.target.value)
              if (/^\d+$/.test(event.target.value) && next > 0) saveChannelLimit(next)
            }}
            inputMode="numeric"
            aria-label="Channels on your Postiz plan"
            className={`${INPUT_CLASS} w-16 px-2 text-sm`}
          />
        </label>
      </div>
    </section>
  )
}
