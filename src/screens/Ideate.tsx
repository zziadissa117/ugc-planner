// IDEATE - where the next recording gets better.
//
// "An in-depth view per account (views, minimum views, paid/not-paid
// accounts, how much made); per account, the videos posted that week,
// clickable to analyze and write notes for the next recording." Students
// record on three days and spend two to four hours a week, on other days,
// looking back at what went out and deciding what to change. This is that
// sitting: one week (Sunday to Saturday), every campaign, every account.
//
// Everything on it is read from what already happened, and nothing is made
// up to fill a gap:
//
//   - posts are his own ticks on the Post grid (video_posts), one per tick;
//   - money is the earnings history, which records the account each tick
//     paid on, so it is shown per account - and per campaign, which also
//     holds anything not on a listed account;
//   - views are the cutter's readings, the owner's only, matched to his saved
//     handles exactly as the campaign's Analytics matches them. Read only:
//     nothing here ticks, schedules or marks anything. Where there are none,
//     it says "No views yet".
//
// The notes are the point of the screen, and the only thing it writes.

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { IdeateNoteBox, type NoteBoxHandle } from '../components/IdeateNoteBox'
import { BackIcon, ChevronDownIcon, ChevronRightIcon, PlatformGlyph } from '../components/icons'
import { Button, Card, ScreenHeader, StateDot } from '../components/ui'
import { localToday, type Campaign, type CampaignAccount, type IdeateNote } from '../data'
import { byRecordingPriority } from '../data/campaignOrder'
import { cutterCampaignFor, readSince, summariseViews, viewFlag, type CampaignViews, type MyAccount } from '../data/campaignViews'
import { EARNINGS_HISTORY_START, payForAccount, paysPerPlatform } from '../data/earnings'
import {
  addDays,
  campaignWeek,
  dayLabel,
  ideateTimeLine,
  localDay,
  notesFor,
  sundayOf,
  weekBounds,
  weekEndOf,
  weekName,
  weekRange,
  weekViewsByAccount,
  type AccountWeek,
  type AccountWeekViews,
  type CampaignWeek,
  type WeekPost,
} from '../data/ideate'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { formatViews } from '../data/views'
import { byBestPay, formatCents } from '../money'
import { fetchCutterViews, listCutterCampaigns } from '../sync/cutterViews'
import { useIsOwner } from '../sync/owner'

const count = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The Campaigns list's order, so the two screens agree: the high-quality
 *  campaigns (a minimum views) first, then the quick ones, each best pay
 *  first (src/data/campaignOrder.ts). */
function inCampaignsOrder<T extends Campaign>(campaigns: readonly T[], accounts: readonly CampaignAccount[]): T[] {
  return byRecordingPriority(byBestPay(campaigns, accounts))
}

export function Ideate() {
  const data = useData()
  const owner = useIsOwner()
  const thisWeek = sundayOf(localToday())
  const [weekStart, setWeekStart] = useState(thisWeek)

  const [loaded] = useLoaded(async () => {
    const [campaigns, accounts, videos, posts, events, blocks] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
      data.listVideos(),
      data.listAllVideoPosts(),
      data.listEarningsEvents({ since: weekStart }),
      data.listPlanBlocks(),
    ])
    const angles = new Map<string, string>()
    for (const list of await Promise.all(campaigns.map((c) => data.listCampaignAngles(c.id)))) {
      for (const angle of list) angles.set(angle.id, angle.label)
    }
    const weeks = inCampaignsOrder(campaigns, accounts).map((c) => campaignWeek(c, accounts, videos, posts, events, weekStart))
    return { weekStart, weeks, angles, blocks }
  }, [data, weekStart])
  // Read apart from the rest, so saving a note reads only the notes again.
  const [notes, reloadNotes] = useLoaded(() => data.listIdeateNotes(), [data])

  // Until the week asked for has been read, show none rather than the last
  // week's posts under this week's name.
  const current = loaded?.weekStart === weekStart ? loaded : null
  const views = useWeekViews(owner, current?.weeks ?? null, weekStart)
  const viewErrors = [...new Set([...(views?.values() ?? [])].flatMap((v) => (v.kind === 'error' ? [v.message] : [])))]

  const ideateLine = loaded ? ideateTimeLine(loaded.blocks) : null
  const posts = current?.weeks.reduce((sum, w) => sum + w.accounts.reduce((n, a) => n + a.posts.length, 0), 0) ?? 0
  const made = current?.weeks.reduce((sum, w) => sum + w.cents, 0) ?? 0
  const noHistory = weekEndOf(weekStart) < EARNINGS_HISTORY_START

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <ScreenHeader
        kicker="Ideate"
        title="Make the next recording better"
        meta={
          loaded === null ? null : ideateLine ?? (
            <>
              No ideate time in your week yet.{' '}
              <Link to="/start" className="text-text underline decoration-edge-lit underline-offset-4">
                Add it to your week
              </Link>
            </>
          )
        }
      />

      <WeekPicker
        weekStart={weekStart}
        thisWeek={thisWeek}
        onChange={setWeekStart}
        summary={current === null ? null : `${plural(posts, 'post')}${noHistory ? '' : ` · ${formatCents(made)} made`}`}
      />

      {viewErrors.length > 0 ? <p className="text-base text-state-blocked">Views couldn't be read: {viewErrors.join(' ')}</p> : null}

      {current === null ? null : current.weeks.length === 0 ? (
        <p className="text-base text-state-later">
          No campaigns yet.{' '}
          <Link to="/campaigns/new" className="text-text underline decoration-edge-lit underline-offset-4">
            Add one
          </Link>{' '}
          and its posts will show here.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {current.weeks.map((week, index) => (
            <CampaignCard
              key={week.campaign.id}
              index={index}
              week={week}
              weekStart={weekStart}
              isThisWeek={weekStart === thisWeek}
              views={views === null ? null : (views.get(week.campaign.id) ?? { kind: 'loading' })}
              notes={notes ?? []}
              angles={current.angles}
              onNotesChanged={reloadNotes}
              onOpenWeek={setWeekStart}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// --- The week ---------------------------------------------------------------

function WeekPicker({
  weekStart,
  thisWeek,
  onChange,
  summary,
}: {
  weekStart: string
  thisWeek: string
  onChange: (weekStart: string) => void
  summary: string | null
}) {
  const name = weekName(weekStart)
  const range = weekRange(weekStart)
  return (
    <div className="flex flex-col items-center gap-2">
      <Card className="flex w-full items-center gap-3 p-2">
        <Button size="small" aria-label="Previous week" className="!px-3" onClick={() => onChange(addDays(weekStart, -7))}>
          <BackIcon className="h-5 w-5" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <p className="text-lg font-semibold text-text" aria-live="polite">
            {name}
          </p>
          <p className="meta numeric text-state-later">
            {name === range ? null : `${range} · `}
            {summary ?? ' '}
          </p>
        </div>
        <Button
          size="small"
          aria-label="Next week"
          className="!px-3"
          disabled={weekStart >= thisWeek}
          onClick={() => onChange(addDays(weekStart, 7))}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </Button>
      </Card>
      {weekStart < addDays(thisWeek, -7) ? (
        <Button variant="ghost" size="small" onClick={() => onChange(thisWeek)}>
          Back to this week
        </Button>
      ) : null}
    </div>
  )
}

// --- Views, read only ---------------------------------------------------------

type Views =
  | { kind: 'loading' }
  | { kind: 'not-linked' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; week: Map<string, AccountWeekViews>; month: CampaignViews }

interface ViewTarget {
  id: string
  name: string
  cutter_campaign_id: string | null
  min_views: number | null
  accounts: MyAccount[]
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The cutter's readings for every campaign shown, for the owner only - the
 *  same reading as the campaign's Analytics (src/screens/CampaignAnalytics.tsx).
 *  Null for anyone else: there is nothing of theirs to read yet. Read again
 *  only when the week or the accounts change, never because a note was saved. */
function useWeekViews(owner: boolean, weeks: readonly CampaignWeek[] | null, weekStart: string): Map<string, Views> | null {
  const key = useMemo(() => {
    if (weeks === null) return null
    const targets: ViewTarget[] = weeks.map((w) => ({
      id: w.campaign.id,
      name: w.campaign.name,
      cutter_campaign_id: w.campaign.cutter_campaign_id,
      min_views: w.campaign.min_views,
      accounts: w.accounts.map(({ account }) => ({ id: account.id, platform: account.platform, handle: account.handle })),
    }))
    return JSON.stringify(targets)
  }, [weeks])
  const tag = `${weekStart}|${key}`
  const [states, setStates] = useState<{ tag: string; byCampaign: Map<string, Views> }>({ tag: '', byCampaign: new Map() })

  useEffect(() => {
    if (!owner || key === null) return
    const targets = JSON.parse(key) as ViewTarget[]
    const forTag = `${weekStart}|${key}`
    let cancelled = false
    const put = (id: string, state: Views) => {
      if (cancelled) return
      setStates((prev) => ({ tag: forTag, byCampaign: new Map(prev.tag === forTag ? prev.byCampaign : []).set(id, state) }))
    }
    const all = (state: Views) => targets.forEach((t) => put(t.id, state))

    void (async () => {
      let cutterCampaigns: { id: string; name: string }[] = []
      if (targets.some((t) => !t.cutter_campaign_id)) {
        try {
          const listed = await listCutterCampaigns()
          if (listed === null) return all({ kind: 'error', message: 'Views are only available on your own account.' })
          cutterCampaigns = listed
        } catch (error) {
          return all({ kind: 'error', message: describe(error) })
        }
      }
      const now = new Date()
      const { from, to } = weekBounds(weekStart)
      // Far enough back for the week shown and for this month's figures.
      const since = new Date(Math.min(Date.parse(readSince(now)), from)).toISOString()
      await Promise.all(
        targets.map(async (t) => {
          const cutterId = cutterCampaignFor(t, cutterCampaigns)
          if (!cutterId) return put(t.id, { kind: 'not-linked' })
          try {
            const posts = await fetchCutterViews(cutterId, since)
            if (posts === null) return put(t.id, { kind: 'error', message: 'Views are only available on your own account.' })
            put(t.id, {
              kind: 'ready',
              week: weekViewsByAccount(posts, t.accounts, from, to, t.min_views),
              month: summariseViews(posts, t.accounts, now),
            })
          } catch (error) {
            put(t.id, { kind: 'error', message: describe(error) })
          }
        }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [owner, key, weekStart])

  if (!owner) return null
  return states.tag === tag ? states.byCampaign : new Map()
}

// --- One campaign -----------------------------------------------------------------

function CampaignCard({
  week,
  weekStart,
  isThisWeek,
  views,
  notes,
  angles,
  onNotesChanged,
  onOpenWeek,
  index,
}: {
  week: CampaignWeek
  weekStart: string
  isThisWeek: boolean
  views: Views | null
  notes: readonly IdeateNote[]
  angles: ReadonlyMap<string, string>
  onNotesChanged: () => Promise<void>
  onOpenWeek: (weekStart: string) => void
  index: number
}) {
  const { campaign } = week
  const accounts = week.accounts.map((a) => a.account)
  const noHistory = weekEndOf(weekStart) < EARNINGS_HISTORY_START
  const whole = notesFor(notes, campaign.id, null, weekStart)
  const titleId = useId()

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="settle-in flex flex-col gap-5 p-5"
      style={{ '--i': index } as CSSProperties}
    >
      <h2 id={titleId} className="display break-words text-2xl text-text">
        {campaign.name}
      </h2>

      <div className="grid grid-cols-3 gap-3 border-y border-rule py-4">
        <Stat label="Videos">
          {week.videosPosted}
          {campaign.posts_per_week > 0 ? <Quiet> of {campaign.posts_per_week}</Quiet> : null}
        </Stat>
        <Stat label="Made">{noHistory ? <Quiet>No history</Quiet> : formatCents(week.cents)}</Stat>
        <Stat label="Min views">{campaign.min_views == null ? <Quiet>No minimum</Quiet> : formatViews(campaign.min_views)}</Stat>
      </div>

      {!noHistory && week.unlistedCents !== 0 ? (
        <p className="meta -mt-2 text-state-later">
          {formatCents(week.unlistedCents)} of it is on accounts not listed here.
        </p>
      ) : null}
      {noHistory ? (
        <p className="meta -mt-2 text-state-later">The earnings history starts on Oct 1, 2026.</p>
      ) : null}
      {views?.kind === 'ready' ? (
        <p className="meta -mt-2 text-state-later">
          This month: <span className="numeric text-text">{count(views.month.monthViews)}</span> views across{' '}
          {plural(views.month.monthPosts, 'post')}
          {views.month.monthUnread > 0 ? ` · ${views.month.monthUnread} not read yet` : ''}
        </p>
      ) : null}
      {views?.kind === 'not-linked' ? (
        <p className="meta -mt-2 text-state-later">No cutter campaign called {campaign.name}, so there are no views to read for it.</p>
      ) : null}

      {accounts.length === 0 ? (
        <p className="text-base text-state-later">
          No accounts on this campaign yet.{' '}
          <Link to={`/campaigns/${campaign.id}`} className="text-text underline decoration-edge-lit underline-offset-4">
            Add them on its brief
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {week.accounts.map((accountWeek) => (
            <AccountSection
              key={accountWeek.account.id}
              campaign={campaign}
              accounts={accounts}
              accountWeek={accountWeek}
              weekStart={weekStart}
              isThisWeek={isThisWeek}
              noHistory={noHistory}
              views={views}
              notes={notes}
              angles={angles}
              onNotesChanged={onNotesChanged}
              onOpenWeek={onOpenWeek}
            />
          ))}
        </ul>
      )}

      <div className="border-t border-rule pt-5">
        <IdeateNoteBox
          key={`${campaign.id}:${weekStart}`}
          campaignId={campaign.id}
          accountId={null}
          weekStart={weekStart}
          thisWeek={whole.thisWeek}
          earlier={whole.earlier}
          label="Notes for the whole campaign"
          placeholder="What to change across every account next recording."
          onChanged={onNotesChanged}
          onOpenWeek={onOpenWeek}
        />
      </div>
    </Card>
  )
}

// --- One account --------------------------------------------------------------

function AccountSection({
  campaign,
  accounts,
  accountWeek,
  weekStart,
  isThisWeek,
  noHistory,
  views,
  notes,
  angles,
  onNotesChanged,
  onOpenWeek,
}: {
  campaign: Campaign
  accounts: readonly CampaignAccount[]
  accountWeek: AccountWeek
  weekStart: string
  isThisWeek: boolean
  noHistory: boolean
  views: Views | null
  notes: readonly IdeateNote[]
  angles: ReadonlyMap<string, string>
  onNotesChanged: () => Promise<void>
  onOpenWeek: (weekStart: string) => void
}) {
  const { account, posts, cents } = accountWeek
  const noteBox = useRef<NoteBoxHandle>(null)
  const scoped = notesFor(notes, campaign.id, account.id, weekStart)
  const handle = account.handle?.trim() ? `@${account.handle.trim().replace(/^@+/, '')}` : null

  const rate = payForAccount(campaign, account)
  const paying = accounts.filter((a) => !a.bonus_only).length
  const pay = account.bonus_only
    ? 'Bonus only - not paid per post'
    : rate === null
      ? 'Paid per post · rate not saved yet'
      : paysPerPlatform(campaign, accounts) || paying <= 1
        ? `Paid per post · ${formatCents(rate)} a post`
        : `Paid per post · ${formatCents(rate)} a video, across ${paying} platforms`

  const seen = views?.kind === 'ready' ? views.week.get(account.id) : undefined
  const last24 = isThisWeek && views?.kind === 'ready' ? (views.month.accounts.find((a) => a.key === account.id)?.last24 ?? null) : null
  const flag = viewFlag(last24)

  return (
    <li>
      <section aria-label={`${account.platform} ${handle ?? ''}`.trim()} className="flex flex-col gap-4 py-5">
        <header className="flex flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <PlatformGlyph platform={account.platform} className="h-5 w-5 shrink-0 text-text-dim" />
            <span className="text-lg font-semibold text-text">{account.platform}</span>
            <span className="meta min-w-0 truncate text-state-later">{handle ?? 'no handle saved'}</span>
          </span>
          <p className="meta text-state-later">{pay}</p>
        </header>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Posts">{posts.length}</Stat>
          <Stat label="Made">
            {account.bonus_only ? (
              <Quiet>Bonus only</Quiet>
            ) : noHistory ? (
              <Quiet>No history</Quiet>
            ) : cents === 0 && rate === null ? (
              <Quiet>No rate saved</Quiet>
            ) : (
              formatCents(cents)
            )}
          </Stat>
          <Stat label="Views">
            {views?.kind === 'loading' ? (
              <Quiet>Reading…</Quiet>
            ) : seen && seen.views !== null ? (
              count(seen.views)
            ) : (
              <Quiet>No views yet</Quiet>
            )}
          </Stat>
        </div>

        {seen && seen.views !== null ? (
          <p className="meta -mt-2 text-state-later">
            On {plural(seen.read, 'post')} that went out {isThisWeek ? 'this' : 'that'} week
            {seen.posts > seen.read ? ` · ${seen.posts - seen.read} not read yet` : ''}
            {campaign.min_views != null ? ` · ${seen.reachedMin} of ${seen.read} reached ${formatViews(campaign.min_views)}` : ''}
          </p>
        ) : null}
        {last24 !== null ? (
          <div className="-mt-2 flex flex-col gap-1">
            <p className="meta text-state-later">
              Last 24 hours: <span className="numeric text-text">{count(last24)}</span> views
            </p>
            {flag !== null ? (
              <p className="text-sm text-state-waiting">In the past 24 hours, we had less than {flag} views for this account.</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="label text-state-later">Posted {isThisWeek ? 'this' : 'that'} week</p>
          {posts.length === 0 ? (
            <p className="text-base text-state-later">Nothing posted on this account {isThisWeek ? 'yet this week' : 'that week'}.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule border-y border-rule">
              {posts.map((item) => (
                <PostRow
                  key={item.post.id}
                  item={item}
                  angle={item.video?.angle_id ? (angles.get(item.video.angle_id) ?? null) : null}
                  onNote={(text) => noteBox.current?.append(text)}
                />
              ))}
            </ul>
          )}
        </div>

        <IdeateNoteBox
          key={`${account.id}:${weekStart}`}
          handle={noteBox}
          campaignId={campaign.id}
          accountId={account.id}
          weekStart={weekStart}
          thisWeek={scoped.thisWeek}
          earlier={scoped.earlier}
          label="Notes for the next recording"
          placeholder="What worked, what didn't, what to try next time on this account."
          onChanged={onNotesChanged}
          onOpenWeek={onOpenWeek}
        />
      </section>
    </li>
  )
}

/** One post that went out: when, which of the week's videos, where. Opens to
 *  what the planner knows about it, and to a line in the account's note. */
function PostRow({ item, angle, onNote }: { item: WeekPost; angle: string | null; onNote: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const { post, day, videoNumber, video, alsoOn } = item
  const time = new Date(post.posted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const url = post.url && /^https?:\/\//i.test(post.url) ? post.url : null

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="press flex min-h-tap w-full items-center gap-3 text-left"
      >
        <StateDot tone="posted" />
        <span className="min-w-0 flex-1">
          <span className="text-base text-text">{dayLabel(day)}</span>{' '}
          <span className="meta text-state-later">
            · Video {videoNumber} · {post.platform}
          </span>
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-brand transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div id={panelId} className="settle-in flex flex-col gap-3 pb-4 pl-5">
          <p className="meta text-state-later">
            Went out at {time}
            {alsoOn.length > 0 ? ` · also on ${alsoOn.join(', ')}` : ''}
          </p>
          {angle ? (
            <p className="text-base text-text-dim">
              <span className="label text-state-later">Angle</span> {angle}
            </p>
          ) : null}
          {video?.script ? (
            <p className="whitespace-pre-wrap break-words border-l-2 border-edge pl-3 text-base text-text-dim">{video.script}</p>
          ) : null}
          {post.view_count !== null ? (
            <p className="meta text-state-later">
              <span className="numeric text-text">{count(post.view_count)}</span> views saved on this post
              {post.view_count_entered_at ? ` on ${dayLabel(localDay(post.view_count_entered_at))}` : ''}
            </p>
          ) : null}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="meta self-start text-text underline decoration-edge-lit underline-offset-4">
              Open the post
            </a>
          ) : null}
          <Button size="small" className="self-start" onClick={() => onNote(`Video ${videoNumber} (${dayLabel(day)}): `)}>
            Write a note about it
          </Button>
        </div>
      ) : null}
    </li>
  )
}

// --- Small pieces --------------------------------------------------------------

/** A figure with its caption over it - each block's headline numbers. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p id={id} className="label text-state-later">
        {label}
      </p>
      <p aria-labelledby={id} className="numeric break-words text-xl font-semibold leading-tight text-text">
        {children}
      </p>
    </div>
  )
}

/** A figure that is not a number: unknown, not tracked, not saved. */
function Quiet({ children }: { children: ReactNode }) {
  return <span className="text-base font-normal tracking-normal text-state-later">{children}</span>
}
