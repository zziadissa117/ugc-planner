// IDEATE's body: a period and a campaign at the top, then what went out and
// how it did.
//
//   All campaigns   the overall picture - videos out, total, average and
//                   median views, hit rates, the best videos anywhere, and the
//                   same figures by campaign, by platform and by day.
//   One campaign    the same figures for it alone, what's working in it (its
//                   best and weakest videos), each account, every video, and
//                   the two kinds of notes.
//
// "I need to choose the campaign and have all the analytics, video preview
// then when we click on the video preview it pops up the link on instagram.
// With average views, best performing, worst performing, notes from Ziad,
// your own notes." - and "the What's Working section has to be filtered by
// the selection of the campaign".
//
// It takes everything as props, so the coach screen shows a student's
// campaigns with the same component: the only difference is which notes are
// editable, which is whichever section is handed an editor.
//
// Read only, apart from the notes. Nothing here ticks, schedules or marks
// anything (CLAUDE.md, "Views are read, never acted on"). A video whose
// views have not come in says so, and is never shown as 0.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link } from 'react-router-dom'

import type { Campaign, CampaignAccount, IdeateNote } from '../data'
import {
  ALL,
  IDEATE_PERIODS,
  byAccount,
  byCampaign,
  byDay,
  byPlatform,
  compactViews,
  dayLabel,
  dayRange,
  hasHandles,
  headlineViews,
  homeOptions,
  ideateVideos,
  percent,
  periodDays,
  rankedByViews,
  shortDay,
  standouts,
  sundayOf,
  videoStats,
  videosIn,
  viewsComingIn,
  type AccountRow,
  type CampaignRow,
  type DayRow,
  type HitRate,
  type HomeOption,
  type IdeatePeriod,
  type IdeateVideo,
  type PlatformRow,
  type VideoStats,
} from '../data/ideate'
import type { CoachNoteRow } from '../sync/coach'
import type { PostizPostsAnswer } from '../sync/postizPosts'
import { ChevronRightIcon, PlatformGlyph } from './icons'
import { NotesSection, type NoteDraft, type NotesHandle, type ShownNote } from './IdeateNotes'
import { Button, Card, SectionLabel } from './ui'

/** Where the videos stand: still being read, unreadable, or read. */
export type PostsState =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; answer: PostizPostsAnswer }

/** A coach note as either side holds it: the student's synced row, or the
 *  coach function's answer. */
export type CoachNoteLike = Pick<
  CoachNoteRow,
  'id' | 'campaign_id' | 'post_id' | 'post_url' | 'week_start' | 'body' | 'created_at' | 'updated_at'
>

export interface NoteEditor {
  save(campaignId: string, draft: NoteDraft): Promise<void>
  remove(id: string): Promise<void>
}

export interface IdeateBoardProps {
  /** Active ones, in the order to offer them. */
  campaigns: readonly Campaign[]
  accounts: readonly CampaignAccount[]
  posts: PostsState
  period: IdeatePeriod
  onPeriod: (period: IdeatePeriod) => void
  /** The Sunday a note written now is filed under. */
  weekStart: string
  ownNotes: readonly IdeateNote[]
  coachNotes: readonly CoachNoteLike[]
  /** Present when the viewer writes the student's own notes. */
  ownEditor?: NoteEditor
  /** Present when the viewer writes Ziad's notes. */
  coachEditor?: NoteEditor
  /** "Your notes", or the student's name on the coach screen. */
  ownTitle: string
  showCoachNotes: boolean
  /** Whose planner this is: links into Setup and the campaign pages only
   *  make sense on one's own. */
  subject: 'self' | 'student'
  ownMaxLength?: number
  coachMaxLength?: number
  /** Reads the videos again after a failed read. */
  onRetry?: () => void
}

/** Videos shown at a time in the grid. Divides by 3, 4 and 6 - the grid's
 *  columns on a phone, a tablet and a desktop. */
const PAGE = 24

const IN_PERIOD: Record<IdeatePeriod, string> = {
  week: 'this week',
  'last-week': 'last week',
  '30-days': 'in the last 30 days',
}

const count = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`
const compactOrDash = (n: number | null) => (n === null ? '—' : compactViews(n))

/** An http(s) link, or nothing - never a javascript: or data: one. */
const safe = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null)

const viewsText = (views: number | null) => (views === null ? 'views not in yet' : `${count(views)} views`)

/** "Instagram + TikTok" */
function platformsOf(video: IdeateVideo): string {
  return [...new Set(video.posts.map((p) => p.post.platform))].join(' + ')
}

/** "Instagram + TikTok, Tue, Nov 24" */
function describeVideo(video: IdeateVideo): string {
  return [platformsOf(video), video.day ? dayLabel(video.day) : null].filter(Boolean).join(', ')
}

export function IdeateBoard(props: IdeateBoardProps) {
  const { campaigns, accounts, posts, period, onPeriod, subject, onRetry } = props
  const answer = posts.kind === 'ready' && posts.answer.connected ? posts.answer : null
  // A month is about a thousand videos: placed once per read, not per render.
  const videos = useMemo(() => (answer ? ideateVideos(answer.posts, campaigns, accounts) : null), [answer, campaigns, accounts])
  const [chosen, setChosen] = useState<{ key: string; name: string }>({ key: ALL, name: 'All campaigns' })
  const options = useMemo(() => homeOptions(campaigns, videos, [chosen]), [campaigns, videos, chosen])
  const selected = options.find((o) => o.key === chosen.key) ?? options[0]
  const scoped = useMemo(() => (videos ? videosIn(videos, selected.key) : null), [videos, selected.key])
  const days = useMemo(() => periodDays(period), [period])
  const tabsId = useId()
  // Picking a campaign from the overview's table lands at the top of its
  // figures, not halfway down its video grid where the table was.
  const top = useRef<HTMLDivElement>(null)
  const openFromTable = (o: HomeOption) => {
    setChosen({ key: o.key, name: o.name })
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => top.current?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' }))
  }

  const notice = postsNotice(posts, subject, onRetry)
  const status = answer && scoped ? statusLine(answer, scoped) : null

  return (
    <div className="flex flex-col gap-8">
      <div ref={top} className="flex scroll-mt-4 flex-col gap-4 border-b border-rule pb-6">
        <PeriodSwitch value={period} onChange={onPeriod} />
        <CampaignPicker idPrefix={tabsId} options={options} selected={selected.key} onPick={(o) => setChosen({ key: o.key, name: o.name })} />
      </div>

      <div role="tabpanel" aria-labelledby={`${tabsId}-${selected.key}`} className="flex flex-col gap-9">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="display min-w-0 text-[1.625rem] text-text [overflow-wrap:anywhere]">{selected.name}</h2>
          <p className="meta shrink-0 text-state-later">{dayRange(days[0], days[days.length - 1])}</p>
        </header>

        {notice ? <div className="settle-in -mt-5">{notice}</div> : null}
        {status ? <p className="meta -mt-5 text-text-dim">{status}</p> : null}

        {selected.kind === 'all' ? (
          scoped ? (
            <Overview videos={scoped} options={options} days={days} period={period} onPick={openFromTable} />
          ) : null
        ) : (
          <CampaignScope key={selected.key} {...props} option={selected} videos={scoped} days={days} />
        )}
      </div>
    </div>
  )
}

/** What is said in place of the videos when they are not there to show. */
function postsNotice(posts: PostsState, subject: 'self' | 'student', onRetry?: () => void): ReactNode {
  if (posts.kind === 'loading') return <Quiet>Loading videos…</Quiet>
  if (posts.kind === 'offline') return <Quiet>Offline. Videos and views need a connection.</Quiet>
  if (posts.kind === 'signed-out') {
    return (
      <Quiet>
        <Link to="/settings" className="font-semibold text-brand hover:text-text">
          Sign in
        </Link>{' '}
        to see your videos.
      </Quiet>
    )
  }
  if (posts.kind === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-base text-text-dim">Videos didn't load: {posts.message}</p>
        {onRetry ? (
          <Button variant="quiet" size="small" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    )
  }
  if (!posts.answer.connected) {
    return subject === 'self' ? (
      <Quiet>
        <Link to="/settings#postiz" className="font-semibold text-brand hover:text-text">
          Add your Postiz key
        </Link>{' '}
        to see your videos here.
      </Quiet>
    ) : (
      <Quiet>No Postiz key saved yet.</Quiet>
    )
  }
  return null
}

/** One quiet line about views still on their way - only for posts read from
 *  Postiz, which reads views a few at a time. The cutter's own records are
 *  never short of anything, so a key the cutter posts with gets no line. */
function statusLine(answer: PostizPostsAnswer, videos: readonly IdeateVideo[]): string | null {
  if (answer.source === 'cutter') return null
  const coming = viewsComingIn(videos, answer.reading)
  if (coming > 0) return `Views for ${plural(coming, 'video is', 'videos are')} still coming in.`
  return answer.error?.trim() || null
}

// --- Controls ------------------------------------------------------------------------

function PeriodSwitch({ value, onChange }: { value: IdeatePeriod; onChange: (period: IdeatePeriod) => void }) {
  return (
    <div
      role="group"
      aria-label="Period"
      className="grid grid-cols-3 gap-1 self-stretch rounded-full border border-edge bg-white/[0.02] p-1 sm:inline-grid sm:self-start"
    >
      {IDEATE_PERIODS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`press min-h-10 whitespace-nowrap rounded-full px-5 text-sm font-semibold transition-colors duration-200 ${
            value === id ? 'bg-brand/15 text-text shadow-[inset_0_0_0_1px_rgba(134,168,255,0.35)]' : 'text-state-later hover:text-text'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Everything, then each campaign with its videos in the period. A campaign
 *  with none is dimmed, never hidden - an empty week is worth seeing. On a
 *  phone the row scrolls sideways; wider, it wraps. */
function CampaignPicker({
  idPrefix,
  options,
  selected,
  onPick,
}: {
  idPrefix: string
  options: readonly HomeOption[]
  selected: string
  onPick: (option: HomeOption) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Campaign"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const on = option.key === selected
        const empty = option.count === 0
        return (
          <button
            key={option.key}
            id={`${idPrefix}-${option.key}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={option.count === null ? option.name : `${option.name}, ${plural(option.count, 'video')}`}
            onClick={() => onPick(option)}
            className={`press inline-flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border pl-4 pr-3.5 text-base font-semibold transition-colors duration-200 ${
              on
                ? 'border-brand/60 bg-brand/15 text-text'
                : empty
                  ? 'border-edge/60 text-state-later/70 hover:border-edge hover:text-text-dim'
                  : 'border-edge text-text-dim hover:border-edge-lit hover:text-text'
            }`}
          >
            <span>{option.name}</span>
            {option.count !== null ? (
              <span aria-hidden className={`numeric text-sm ${on ? 'text-brand' : 'text-state-later'} ${empty && !on ? 'opacity-70' : ''}`}>
                {count(option.count)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

// --- All campaigns -------------------------------------------------------------------

function Overview({
  videos,
  options,
  days,
  period,
  onPick,
}: {
  videos: readonly IdeateVideo[]
  options: readonly HomeOption[]
  days: readonly string[]
  period: IdeatePeriod
  onPick: (option: HomeOption) => void
}) {
  const stats = useMemo(() => videoStats(videos), [videos])
  const best = useMemo(() => rankedByViews(videos).slice(0, 5), [videos])
  const campaignRows = useMemo(() => byCampaign(videos, options), [videos, options])
  const platformRows = useMemo(() => byPlatform(videos), [videos])
  const dayRows = useMemo(() => byDay(videos, days), [videos, days])
  const nameOf = (video: IdeateVideo) => options.find((o) => o.key === video.homeKey)?.name ?? null

  return (
    <>
      <Headline stats={stats} label="Overview" />

      {videos.length === 0 ? (
        <Quiet>Nothing posted {IN_PERIOD[period]}.</Quiet>
      ) : (
        <>
          {best.length > 0 ? (
            <section aria-label="Best videos" className="flex flex-col gap-4">
              <SectionLabel>Best videos</SectionLabel>
              <ul className="-mx-4 grid snap-x auto-cols-[31%] grid-flow-col gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid-flow-row sm:grid-cols-5 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
                {best.map((video, index) => (
                  <li key={video.id} className="settle-in snap-start" style={{ '--i': index } as CSSProperties}>
                    <VideoTile video={video} context={nameOf(video)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <StatTable<CampaignRow>
            label="By campaign"
            leadLabel="Campaign"
            rows={campaignRows}
            keyOf={(row) => row.key}
            lead={(row) => <span className="truncate font-semibold text-text">{row.name}</span>}
            columns={[
              { label: 'Videos', value: (row) => count(row.videos), strong: true },
              { label: 'Views', value: (row) => compactOrDash(row.total) },
              { label: 'Avg', value: (row) => compactOrDash(row.average) },
              { label: 'Best', value: (row) => compactOrDash(row.best) },
            ]}
            describe={(row) =>
              [row.name, plural(row.videos, 'video'), row.total === null ? 'views not in yet' : `${count(row.total)} views`]
                .concat(row.average === null ? [] : [`average ${count(row.average)}`])
                .concat(row.best === null ? [] : [`best ${count(row.best)}`])
                .join(', ')
            }
            onPick={(row) => {
              const option = options.find((o) => o.key === row.key)
              if (option) onPick(option)
            }}
          />

          <StatTable<PlatformRow>
            label="By platform"
            leadLabel="Platform"
            rows={platformRows}
            keyOf={(row) => row.platform}
            lead={(row) => (
              <>
                <PlatformGlyph platform={row.platform} className="h-4 w-4 shrink-0 text-text-dim" />
                <span className="truncate font-semibold text-text">{row.platform}</span>
              </>
            )}
            columns={[
              { label: 'Posts', value: (row) => count(row.posts), strong: true },
              { label: 'Views', value: (row) => compactOrDash(row.views) },
              { label: 'Avg', value: (row) => compactOrDash(row.average) },
            ]}
          />

          <DayChart rows={dayRows} />
        </>
      )}
    </>
  )
}

// --- One campaign --------------------------------------------------------------------

function CampaignScope({
  option,
  videos,
  campaigns,
  accounts,
  period,
  weekStart,
  ownNotes,
  coachNotes,
  ownEditor,
  coachEditor,
  ownTitle,
  showCoachNotes,
  subject,
  ownMaxLength,
  coachMaxLength,
}: IdeateBoardProps & { option: HomeOption; videos: readonly IdeateVideo[] | null; days: readonly string[] }) {
  const notes = useRef<NotesHandle>(null)
  const campaign = option.campaignId ? (campaigns.find((c) => c.id === option.campaignId) ?? null) : null
  const stats = useMemo(() => (videos ? videoStats(videos) : null), [videos])
  const working = useMemo(() => (videos ? standouts(videos) : null), [videos])
  const accountRows = useMemo(() => (videos ? byAccount(videos) : []), [videos])
  const writes = campaign !== null && (coachEditor !== undefined || ownEditor !== undefined)
  const self = subject === 'self'

  const noteOn = writes
    ? (video: IdeateVideo) =>
        notes.current?.about({
          postId: video.primary.post.id,
          postUrl: safe(video.primary.post.url),
          accountId: video.primary.accountId,
          weekStart: video.day ? sundayOf(video.day) : null,
          label: describeVideo(video),
        })
    : undefined

  return (
    <>
      {videos && stats && working ? (
        <>
          <Headline stats={stats} label={`${option.name} figures`} campaign />

          {videos.length === 0 ? (
            <Quiet>
              Nothing posted {IN_PERIOD[period]}.
              {campaign && !hasHandles(accounts, campaign.id) ? (
                self ? (
                  <>
                    {' '}
                    No account handles on {campaign.name} yet.{' '}
                    <Link to={`/campaigns/${campaign.id}`} className="font-semibold text-brand hover:text-text">
                      Add them
                    </Link>
                  </>
                ) : (
                  <> No account handles on {campaign.name} yet.</>
                )
              ) : null}
            </Quiet>
          ) : (
            <>
              <section aria-label="What's working" className="flex flex-col gap-4">
                <SectionLabel>What's working</SectionLabel>
                {working.best.length === 0 ? (
                  <Quiet>No views in yet for these videos.</Quiet>
                ) : (
                  <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
                    <Standouts title="Best" videos={working.best} onNote={noteOn} />
                    {working.weakest.length > 0 ? <Standouts title="Weakest" videos={working.weakest} onNote={noteOn} /> : null}
                  </div>
                )}
              </section>

              <StatTable<AccountRow>
                label="By account"
                leadLabel="Account"
                rows={accountRows}
                keyOf={(row) => row.key}
                lead={(row) => (
                  <>
                    <PlatformGlyph platform={row.platform} className="h-4 w-4 shrink-0 text-text-dim" />
                    <span className="sr-only">{row.platform} </span>
                    <span className="truncate font-semibold text-text">{row.handle ? `@${row.handle}` : row.platform}</span>
                  </>
                )}
                columns={[
                  { label: 'Posts', value: (row) => count(row.posts), strong: true },
                  { label: 'Avg', value: (row) => compactOrDash(row.average) },
                  { label: 'Best', value: (row) => compactOrDash(row.best) },
                ]}
              />

              <VideoGrid key={period} videos={videos} />
            </>
          )}
        </>
      ) : null}

      {campaign ? (
        <div className={`grid gap-8 ${showCoachNotes ? 'md:grid-cols-2' : ''}`}>
          {showCoachNotes ? (
            <NotesSection
              title="Notes from Ziad"
              notes={coachNotes.filter((n) => n.campaign_id === campaign.id || n.campaign_id === null).map(toShown.coach)}
              onSave={coachEditor ? (draft) => coachEditor.save(campaign.id, draft) : undefined}
              onDelete={coachEditor ? (id) => coachEditor.remove(id) : undefined}
              handle={coachEditor ? notes : undefined}
              aboutAs="link"
              placeholder="What to change next recording"
              empty="Nothing from Ziad yet."
              defaultWeekStart={weekStart}
              maxLength={coachMaxLength}
            />
          ) : null}
          <NotesSection
            title={ownTitle}
            notes={ownNotes.filter((n) => n.campaign_id === campaign.id).map(toShown.own)}
            onSave={ownEditor ? (draft) => ownEditor.save(campaign.id, draft) : undefined}
            onDelete={ownEditor ? (id) => ownEditor.remove(id) : undefined}
            handle={ownEditor && !coachEditor ? notes : undefined}
            aboutAs="text"
            placeholder="What worked, what to try next"
            empty="No notes yet."
            defaultWeekStart={weekStart}
            maxLength={ownMaxLength}
          />
        </div>
      ) : option.kind === 'cutter' ? (
        <section aria-label="Notes" className="flex flex-col gap-3">
          <SectionLabel>Notes</SectionLabel>
          {self ? (
            <Quiet>
              <Link to="/campaigns/new" className="font-semibold text-brand hover:text-text">
                Add {option.name} as a campaign
              </Link>{' '}
              to keep notes on it.
            </Quiet>
          ) : (
            <Quiet>Notes need {option.name} added as a campaign in their planner.</Quiet>
          )}
        </section>
      ) : (
        <section aria-label="Notes" className="flex flex-col gap-3">
          <SectionLabel>Notes</SectionLabel>
          {self ? (
            <Quiet>
              These went out on accounts no campaign lists.{' '}
              <Link to="/campaigns" className="font-semibold text-brand hover:text-text">
                Add the account to a campaign
              </Link>{' '}
              to keep notes on them.
            </Quiet>
          ) : (
            <Quiet>These went out on accounts none of their campaigns lists.</Quiet>
          )}
        </section>
      )}
    </>
  )
}

const toShown = {
  own: (n: IdeateNote): ShownNote => ({
    id: n.id,
    body: n.body,
    createdAt: n.created_at,
    weekStart: n.week_start,
    accountId: n.account_id,
    postId: null,
    postUrl: null,
  }),
  coach: (n: CoachNoteLike): ShownNote => ({
    id: n.id,
    body: n.body,
    createdAt: n.created_at,
    weekStart: n.week_start,
    accountId: null,
    postId: n.post_id,
    postUrl: n.post_url,
  }),
}

function Standouts({ title, videos, onNote }: { title: string; videos: readonly IdeateVideo[]; onNote?: (video: IdeateVideo) => void }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 id={id} className="label text-state-later">
        {title}
      </h3>
      <ul aria-labelledby={id} className="grid grid-cols-3 gap-3">
        {videos.map((video, index) => (
          <li key={video.id} className="settle-in" style={{ '--i': index } as CSSProperties}>
            <VideoTile video={video} onNote={onNote ? () => onNote(video) : undefined} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Every video, newest first, a page at a time - a month can be a thousand. */
function VideoGrid({ videos }: { videos: readonly IdeateVideo[] }) {
  const [shown, setShown] = useState(PAGE)
  const visible = videos.slice(0, shown)
  return (
    <section aria-label="Videos" className="flex flex-col gap-4">
      <SectionLabel trailing={count(videos.length)}>Videos</SectionLabel>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6">
        {visible.map((video, index) => (
          <li key={video.id} className="settle-in" style={{ '--i': index % PAGE } as CSSProperties}>
            <VideoTile video={video} />
          </li>
        ))}
      </ul>
      {videos.length > shown ? (
        <div className="flex items-center justify-between gap-4">
          <p className="meta text-state-later">
            {count(visible.length)} of {count(videos.length)}
          </p>
          <Button size="small" onClick={() => setShown((n) => n + PAGE)}>
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  )
}

// --- Figures -------------------------------------------------------------------------

/** The headline: four big numbers, then the smaller ones under a hairline. */
function Headline({ stats, label, campaign = false }: { stats: VideoStats; label: string; campaign?: boolean }) {
  const unread = stats.posted - stats.read
  return (
    <Card role="group" aria-label={label} className="settle-in flex flex-col gap-6 p-5 sm:p-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
        <Figure label="Videos out" value={count(stats.posted)} />
        <Figure label="Total views" value={stats.total === null ? '—' : headlineViews(stats.total)} exact={stats.total} />
        <Figure label="Average views" value={stats.average === null ? '—' : headlineViews(stats.average)} exact={stats.average} />
        <Figure label="Median views" value={stats.median === null ? '—' : headlineViews(stats.median)} exact={stats.median} />
      </dl>
      <dl className={`grid grid-cols-2 gap-x-4 gap-y-5 border-t border-rule pt-5 ${campaign ? 'sm:grid-cols-4' : ''}`}>
        {campaign ? (
          <>
            <SmallFigure label="Best" value={compactOrDash(stats.best?.views ?? null)} />
            <SmallFigure label="Worst" value={compactOrDash(stats.worst?.views ?? null)} />
          </>
        ) : null}
        <Rate label="1K+ views" rate={stats.over1k} />
        <Rate label="10K+ views" rate={stats.over10k} />
      </dl>
      {unread > 0 && stats.posted > 0 ? (
        <p className="meta -mt-1 text-state-later">
          {count(stats.read)} of {plural(stats.posted, 'video')} have views in. The rest aren't counted yet.
        </p>
      ) : null}
    </Card>
  )
}

/** A headline figure: a small grey caption over a big tabular number. */
function Figure({ label, value, exact }: { label: string; value: string; exact?: number | null }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dt id={id} className="label text-state-later">
        {label}
      </dt>
      <dd
        aria-labelledby={id}
        title={exact !== null && exact !== undefined ? count(exact) : undefined}
        className="numeric font-bold leading-none text-text"
        style={{ fontSize: 'clamp(2rem, 9vw, 2.75rem)' }}
      >
        {value}
      </dd>
    </div>
  )
}

function SmallFigure({ label, value }: { label: string; value: string }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt id={id} className="label text-state-later">
        {label}
      </dt>
      <dd aria-labelledby={id} className="numeric text-2xl font-bold leading-none text-text">
        {value}
      </dd>
    </div>
  )
}

/** A hit rate: the share of read videos at or over a mark, and a thin bar. */
function Rate({ label, rate }: { label: string; rate: HitRate | null }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt id={id} className="label text-state-later">
        {label}
      </dt>
      <dd aria-labelledby={id} className="flex flex-col gap-2.5">
        <span className="flex items-baseline gap-2">
          <span className="numeric text-2xl font-bold leading-none text-text">{rate ? percent(rate.share) : '—'}</span>
          {rate ? (
            <span className="meta numeric text-state-later">
              {count(rate.hits)} of {count(rate.of)}
            </span>
          ) : null}
        </span>
        <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${rate ? rate.share * 100 : 0}%` }} />
        </span>
      </dd>
    </div>
  )
}

// --- Tables ----------------------------------------------------------------------------

interface Column<T> {
  label: string
  value: (row: T) => string
  /** The column the eye reads first. */
  strong?: boolean
}

// Whole class strings, so Tailwind sees them. A phone puts the name on a
// line of its own and the numbers under it; wider, one line.
const GRID: Record<number, { row: string; lead: string }> = {
  3: { row: 'grid grid-cols-3 sm:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))]', lead: 'col-span-3 sm:col-span-1' },
  4: { row: 'grid grid-cols-4 sm:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))]', lead: 'col-span-4 sm:col-span-1' },
}

function StatTable<T>({
  label,
  leadLabel,
  rows,
  keyOf,
  lead,
  columns,
  describe,
  onPick,
}: {
  label: string
  leadLabel: string
  rows: readonly T[]
  keyOf: (row: T) => string
  lead: (row: T) => ReactNode
  columns: readonly Column<T>[]
  /** The row's name for a screen reader, when it is a button. */
  describe?: (row: T) => string
  onPick?: (row: T) => void
}) {
  if (rows.length === 0) return null
  const grid = GRID[columns.length]
  const cells = (row: T) => (
    <>
      <span className={`${grid.lead} flex min-w-0 items-center gap-2.5`}>
        {lead(row)}
        {onPick ? <ChevronRightIcon aria-hidden className="ml-auto h-4 w-4 shrink-0 text-brand sm:hidden" /> : null}
      </span>
      {columns.map((column) => (
        <span
          key={column.label}
          className={`numeric text-right text-base ${column.strong ? 'font-semibold text-text' : 'text-text-dim'}`}
        >
          <span className="sr-only">{column.label}: </span>
          {column.value(row)}
        </span>
      ))}
    </>
  )

  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <SectionLabel>{label}</SectionLabel>
      <Card className="px-4 sm:px-5">
        <div aria-hidden className={`${grid.row} label gap-x-3 border-b border-rule py-3 text-state-later`}>
          <span className="hidden sm:block">{leadLabel}</span>
          {columns.map((column) => (
            <span key={column.label} className="text-right">
              {column.label}
            </span>
          ))}
        </div>
        <ul className="divide-y divide-rule">
          {rows.map((row) => (
            <li key={keyOf(row)}>
              {onPick ? (
                <button
                  type="button"
                  aria-label={describe?.(row)}
                  onClick={() => onPick(row)}
                  className={`${grid.row} -mx-2 w-[calc(100%+1rem)] items-center gap-x-3 gap-y-2 rounded-lg px-2 py-3.5 text-left transition-colors duration-200 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
                >
                  {cells(row)}
                </button>
              ) : (
                <div className={`${grid.row} items-center gap-x-3 gap-y-2 py-3.5`}>{cells(row)}</div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

// --- By day ----------------------------------------------------------------------------

/** Two small charts on one row of days - videos out, and the average views
 *  of the ones read - never one chart with two scales. Point at (or tap, or
 *  arrow to) a day to read it. */
function DayChart({ rows }: { rows: readonly DayRow[] }) {
  const [active, setActive] = useState<number | null>(null)
  const lastBusy = rows.reduce((last, row, i) => (row.videos > 0 ? i : last), rows.length - 1)
  const index = active ?? lastBusy
  const current = rows[index]
  const maxVideos = Math.max(1, ...rows.map((r) => r.videos))
  const maxAverage = Math.max(1, ...rows.map((r) => r.average ?? 0))
  const tableId = useId()

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return
    const at = Math.floor(((event.clientX - box.left) / box.width) * rows.length)
    setActive(Math.min(rows.length - 1, Math.max(0, at)))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (step !== 0) {
      event.preventDefault()
      setActive(Math.min(rows.length - 1, Math.max(0, index + step)))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : rows.length - 1)
    }
  }

  const averageText =
    current.average !== null ? `${compactViews(current.average)} average views` : current.videos > 0 ? 'views not in yet' : null

  return (
    <section aria-label="By day" className="flex flex-col gap-4">
      <SectionLabel>By day</SectionLabel>
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <p aria-live="polite" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-base font-semibold text-text">{dayLabel(current.day)}</span>
          <span className="meta numeric text-text-dim">{plural(current.videos, 'video')}</span>
          {averageText ? <span className="meta numeric text-text-dim">{averageText}</span> : null}
        </p>
        <div
          role="group"
          tabIndex={0}
          aria-label="Videos and average views by day"
          aria-describedby={tableId}
          onPointerDown={pick}
          onPointerMove={pick}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setActive(null)
          }}
          onKeyDown={onKeyDown}
          className="flex cursor-crosshair touch-pan-y flex-col gap-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
        >
          <Bars caption="Videos" top={count(maxVideos)} values={rows.map((r) => (r.videos > 0 ? r.videos : null))} max={maxVideos} active={index} />
          <Bars caption="Average views" top={compactViews(maxAverage)} values={rows.map((r) => r.average)} max={maxAverage} active={index} />
          <Axis rows={rows} active={index} />
        </div>
        <table id={tableId} className="sr-only">
          <caption>Videos and average views by day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Videos</th>
              <th scope="col">Average views</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.day}>
                <th scope="row">{dayLabel(row.day)}</th>
                <td>{count(row.videos)}</td>
                <td>{row.average !== null ? count(row.average) : row.videos > 0 ? 'Not in yet' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  )
}

/** One row of bars on a shared baseline. Null is no bar at all - a day with
 *  nothing, or nothing read; a real zero still gets a sliver. */
function Bars({
  caption,
  top,
  values,
  max,
  active,
}: {
  caption: string
  top: string
  values: readonly (number | null)[]
  max: number
  active: number
}) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label text-state-later">{caption}</span>
        <span className="meta numeric text-state-later">{top}</span>
      </div>
      <div className="flex h-16 items-end gap-[2px] border-b border-edge">
        {values.map((value, i) => (
          <span key={i} className="flex h-full min-w-0 flex-1 items-end">
            {value !== null ? (
              <span
                className={`block w-full rounded-t-[4px] transition-colors duration-200 ${i === active ? 'bg-brand' : 'bg-brand/40'}`}
                style={{ height: `max(2px, ${(value / max) * 100}%)` }}
              />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The days under the bars: each one in a week; over thirty, every seventh
 *  counting back from the last, centred on its bar so none run into another. */
function Axis({ rows, active }: { rows: readonly DayRow[]; active: number }) {
  const week = rows.length <= 7
  const last = rows.length - 1
  return (
    <div aria-hidden className="-mt-2 flex gap-[2px]">
      {rows.map((row, i) => {
        const shown = week || (last - i) % 7 === 0
        const text = week ? dayLabel(row.day).slice(0, 3) : shortDay(row.day)
        const place = week ? 'inset-x-0 text-center' : i === last ? 'right-0' : i < 3 ? 'left-0' : 'left-1/2 -translate-x-1/2'
        return (
          <span key={row.day} className="relative h-5 min-w-0 flex-1">
            {shown ? (
              <span className={`meta absolute top-0 whitespace-nowrap ${place} ${i === active ? 'text-text' : 'text-state-later'}`}>{text}</span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

// --- Videos ----------------------------------------------------------------------------

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-base text-state-later">{children}</p>
}

/** The first line of a caption, short. */
function firstLine(caption: string): string {
  const line = caption.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

/** One video, however many platforms it went to: its preview in 9:16 with
 *  a mark for each platform, then its views and the day under it. A tap
 *  opens it on Instagram when it went there - "it pops up the link on
 *  instagram" - else wherever it has a link; with several, each platform's
 *  mark opens that platform's post. Without any link it is only a picture,
 *  and says nothing about where it would go. */
function VideoTile({ video, context, onNote }: { video: IdeateVideo; context?: string | null; onNote?: () => void }) {
  const primary = video.primary.post
  const url = safe(primary.url)
  const name = [describeVideo(video), viewsText(video.views)].join(', ')
  const caption = firstLine(video.caption)
  const title = [video.day ? dayLabel(video.day) : null, caption].filter(Boolean).join(' · ') || undefined
  const several = video.posts.length > 1

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        title={title}
        className="group relative aspect-[9/16] overflow-hidden rounded-xl border border-edge bg-surface-raised transition-[border-color,transform] duration-200 hover:border-edge-lit has-[>a:active]:scale-[0.97]"
      >
        <Preview video={video} />
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${name}, opens on ${primary.platform}`}
            className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          />
        ) : (
          <span role="img" aria-label={name} className="absolute inset-0" />
        )}
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1">
          {video.posts.map(({ post }) => {
            const link = several ? safe(post.url) : null
            const glyph = <PlatformGlyph platform={post.platform} className="h-3.5 w-3.5" />
            const chip = 'flex size-6 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-sm'
            return link ? (
              <a
                key={post.id}
                href={link}
                target="_blank"
                rel="noreferrer"
                aria-label={`${post.platform} post, ${viewsText(post.views)}`}
                title={`${post.platform} · ${viewsText(post.views)}`}
                className={`${chip} press pointer-events-auto transition-colors duration-200 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
              >
                {glyph}
              </a>
            ) : (
              <span key={post.id} aria-hidden className={chip}>
                {glyph}
              </span>
            )
          })}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        {video.views === null ? (
          <p className="text-[0.8125rem] font-semibold leading-snug text-state-later">Views not in yet</p>
        ) : (
          <p className="numeric text-lg font-bold leading-snug text-text">{compactViews(video.views)}</p>
        )}
        <p className="meta truncate text-state-later">{video.day ? shortDay(video.day) : ' '}</p>
        {context ? <p className="meta truncate text-text-dim">{context}</p> : null}
        {onNote ? (
          <button
            type="button"
            aria-label={`Note on this video: ${name}`}
            onClick={onNote}
            className="meta -mx-1 mt-0.5 self-start rounded-md px-1 py-1 font-semibold text-brand transition-colors duration-200 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Note
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** True once the element is within a screen or so of the viewport - and at
 *  once where there is no IntersectionObserver to ask. A month's grid would
 *  otherwise start a thousand video downloads. */
function useNear(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near) return
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, ref])
  return near
}

/** The first frame of the video file - never playing - or the picture. With
 *  no preview at all, or one that will not load, a plain card with the
 *  caption's first line, or the day it went out. */
function Preview({ video }: { video: IdeateVideo }) {
  const box = useRef<HTMLSpanElement>(null)
  const near = useNear(box)
  const [broken, setBroken] = useState(false)
  const src = video.preview && !broken ? safe(video.preview.src) : null
  const fill = 'absolute inset-0 h-full w-full object-cover'

  let media: ReactNode = null
  if (src && near) {
    media =
      video.preview?.kind === 'video' ? (
        <video
          aria-hidden
          // Safari draws no first frame for preload="metadata" without a start time.
          src={src.includes('#') ? src : `${src}#t=0.5`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          onError={() => setBroken(true)}
          className={`${fill} pointer-events-none`}
        />
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={fill} />
      )
  } else if (!src) {
    const caption = firstLine(video.caption)
    media = caption ? (
      <span className="absolute inset-x-2.5 top-10 line-clamp-6 text-[0.8125rem] font-semibold leading-snug text-text/90 [overflow-wrap:anywhere]">
        {caption}
      </span>
    ) : video.day ? (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="numeric text-2xl font-bold leading-none text-text">{Number(video.day.slice(8))}</span>
        <span className="label text-state-later">{dayLabel(video.day).slice(5, 8)}</span>
      </span>
    ) : null
  }

  return (
    <span ref={box} aria-hidden className="absolute inset-0 overflow-hidden">
      {media}
    </span>
  )
}
