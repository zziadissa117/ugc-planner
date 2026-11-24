// IDEATE's body: pick a campaign and a period, then that campaign's videos -
// how many went out, their average views, the best and the worst, every one
// as a preview that opens the post - and the two kinds of notes.
//
// It takes everything as props, so the coach screen shows a student's
// campaigns with the same component: the only difference is which notes are
// editable, which is whichever section is handed an editor.
//
// Read only, apart from the notes. Nothing here ticks, schedules or marks
// anything (CLAUDE.md, "Views are read, never acted on").

import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign, CampaignAccount, IdeateNote } from '../data'
import {
  IDEATE_PERIODS,
  dayLabel,
  hasHandles,
  localDay,
  sundayOf,
  videoStats,
  videosForCampaign,
  viewsComingIn,
  type CampaignVideo,
  type IdeatePeriod,
} from '../data/ideate'
import { formatViews } from '../data/views'
import type { CoachNoteRow } from '../sync/coach'
import type { PostizPostsAnswer } from '../sync/postizPosts'
import { PlatformGlyph } from './icons'
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
  /** In the order to offer them. */
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
  /** Whose planner this is: links into Setup and the campaign page only make
   *  sense on one's own. */
  subject: 'self' | 'student'
  ownMaxLength?: number
  coachMaxLength?: number
}

export function IdeateBoard(props: IdeateBoardProps) {
  const { campaigns, period, onPeriod } = props
  const [chosen, setChosen] = useState<string | null>(null)
  const campaign = campaigns.find((c) => c.id === chosen) ?? campaigns[0] ?? null
  const tabsId = useId()

  if (campaign === null) return null

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div
          role="tablist"
          aria-label="Campaign"
          className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0"
        >
          {campaigns.map((c) => {
            const on = c.id === campaign.id
            return (
              <button
                key={c.id}
                id={`${tabsId}-${c.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setChosen(c.id)}
                className={`press min-h-11 shrink-0 whitespace-nowrap rounded-full border px-5 text-base font-semibold transition-colors duration-200 ${
                  on ? 'border-brand/60 bg-brand/15 text-text' : 'border-edge text-text-dim hover:border-edge-lit hover:text-text'
                }`}
              >
                {c.name}
              </button>
            )
          })}
        </div>
        <PeriodSwitch value={period} onChange={onPeriod} />
      </div>

      <div role="tabpanel" aria-labelledby={`${tabsId}-${campaign.id}`}>
        <CampaignView key={campaign.id} {...props} campaign={campaign} />
      </div>
    </div>
  )
}

function PeriodSwitch({ value, onChange }: { value: IdeatePeriod; onChange: (period: IdeatePeriod) => void }) {
  return (
    <div
      role="group"
      aria-label="Period"
      className="grid shrink-0 grid-cols-3 gap-1 rounded-full border border-edge bg-white/[0.02] p-1 sm:inline-grid"
    >
      {IDEATE_PERIODS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`press min-h-9 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors duration-200 ${
            value === id ? 'bg-brand/15 text-text shadow-[inset_0_0_0_1px_rgba(134,168,255,0.35)]' : 'text-state-later hover:text-text'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// --- One campaign ------------------------------------------------------------------

const IN_PERIOD: Record<IdeatePeriod, string> = {
  week: 'this week',
  'last-week': 'last week',
  '30-days': 'in the last 30 days',
}

const count = (n: number) => n.toLocaleString('en-US')

/** An http(s) link, or nothing - never a javascript: or data: one. */
const safe = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null)

const viewsText = (views: number | null) => (views === null ? 'views not in yet' : `${count(views)} views`)

function videoDay(video: CampaignVideo): string | null {
  return video.publishedAt ? dayLabel(localDay(video.publishedAt)) : null
}

/** "Instagram + TikTok" */
function platformsOf(video: CampaignVideo): string {
  return [...new Set(video.posts.map((p) => p.post.platform))].join(' + ')
}

/** "Instagram + TikTok, Tue, Nov 24" */
function describeVideo(video: CampaignVideo): string {
  return [platformsOf(video), videoDay(video)].filter(Boolean).join(', ')
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

export function CampaignView({
  campaign,
  accounts,
  posts,
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
}: Omit<IdeateBoardProps, 'campaigns' | 'onPeriod'> & { campaign: Campaign }) {
  const notes = useRef<NotesHandle>(null)
  const answer = posts.kind === 'ready' && posts.answer.connected ? posts.answer : null
  const handles = hasHandles(accounts, campaign.id)
  const items = answer && handles ? videosForCampaign(answer.posts, accounts, campaign.id) : []
  const stats = videoStats(items)
  const coming = answer ? viewsComingIn(items, answer.reading) : 0
  const writes = coachEditor !== undefined || ownEditor !== undefined

  const noteOn = writes
    ? (video: CampaignVideo) =>
        notes.current?.about({
          postId: video.primary.post.id,
          postUrl: safe(video.primary.post.url),
          accountId: video.primary.accountId,
          weekStart: video.publishedAt ? sundayOf(localDay(video.publishedAt)) : null,
          label: describeVideo(video),
        })
    : undefined

  const self = subject === 'self'
  const notice: ReactNode =
    posts.kind === 'loading' ? (
      <Quiet>Reading Postiz…</Quiet>
    ) : posts.kind === 'offline' ? (
      <Quiet>Offline. Videos and views need a connection.</Quiet>
    ) : posts.kind === 'signed-out' ? (
      <Quiet>
        <Link to="/settings" className="font-semibold text-brand hover:text-text">
          Sign in
        </Link>{' '}
        to see your videos.
      </Quiet>
    ) : posts.kind === 'failed' ? (
      <p className="text-base text-state-blocked">Postiz couldn't be read: {posts.message}</p>
    ) : !posts.answer.connected ? (
      self ? (
        <Quiet>
          <Link to="/settings#postiz" className="font-semibold text-brand hover:text-text">
            Add your Postiz key
          </Link>{' '}
          to see your videos here.
        </Quiet>
      ) : (
        <Quiet>No Postiz key saved yet.</Quiet>
      )
    ) : !handles ? (
      self ? (
        <Quiet>
          No account handles on {campaign.name}.{' '}
          <Link to={`/campaigns/${campaign.id}`} className="font-semibold text-brand hover:text-text">
            Add them
          </Link>
        </Quiet>
      ) : (
        <Quiet>No account handles on {campaign.name}.</Quiet>
      )
    ) : null

  return (
    <div className="flex flex-col gap-8">
      {notice ? <div className="settle-in">{notice}</div> : null}
      {answer?.error ? <p className="meta text-state-blocked">{answer.error}</p> : null}

      {answer && handles ? (
        <>
          <Card className="settle-in flex flex-col p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-4">
              <Figure label="Posted" value={count(stats.posted)} />
              <Figure label="Average views" value={stats.average === null ? '—' : count(stats.average)} />
            </div>
            {coming > 0 ? (
              <p className="meta mt-3 text-state-later">
                Views still coming in for {coming} {coming === 1 ? 'video' : 'videos'}
              </p>
            ) : null}
            {stats.best ? (
              <div className="mt-5 grid gap-4 border-t border-rule pt-5 sm:grid-cols-2 sm:gap-6">
                <Standout label="Best" video={stats.best} onNote={noteOn} />
                {stats.worst ? <Standout label="Worst" video={stats.worst} onNote={noteOn} /> : null}
              </div>
            ) : null}
          </Card>

          <section aria-label="Videos" className="flex flex-col gap-3">
            <SectionLabel trailing={items.length > 0 ? items.length : null}>Videos</SectionLabel>
            {items.length === 0 ? (
              <Quiet>Nothing posted {IN_PERIOD[period]}.</Quiet>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5">
                {items.map((video, index) => (
                  <li key={video.id} className="settle-in" style={{ '--i': index } as CSSProperties}>
                    <Tile video={video} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

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
    </div>
  )
}

// --- Pieces ------------------------------------------------------------------------

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-base text-state-later">{children}</p>
}

/** A headline figure: the deck's spaced caption over a big tabular number. */
function Figure({ label, value }: { label: string; value: string }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={id} className="kicker">
        {label}
      </p>
      <p aria-labelledby={id} className="numeric font-bold leading-none text-text" style={{ fontSize: 'clamp(2.5rem, 11vw, 3.5rem)' }}>
        {value}
      </p>
    </div>
  )
}

/** The best or the worst video: its preview, which opens it, and its views. */
function Standout({ label, video, onNote }: { label: string; video: CampaignVideo; onNote?: (video: CampaignVideo) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <Tile video={video} prefix={label} bare className="w-16 shrink-0 rounded-lg sm:w-[4.5rem]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="label text-state-later">{label}</p>
        <p className="numeric text-2xl font-bold leading-tight text-text">
          {count(video.views ?? 0)} <span className="text-base font-normal tracking-normal text-state-later">views</span>
        </p>
        <p className="meta flex min-w-0 items-center gap-1.5 text-state-later">
          {[...new Set(video.posts.map((p) => p.post.platform))].map((platform) => (
            <PlatformGlyph key={platform} platform={platform} className="h-4 w-4 shrink-0" />
          ))}
          <span className="truncate">{videoDay(video) ?? platformsOf(video)}</span>
        </p>
      </div>
      {onNote ? (
        <Button variant="ghost" size="small" className="shrink-0" aria-label={`Note on the ${label.toLowerCase()} video`} onClick={() => onNote(video)}>
          Note
        </Button>
      ) : null}
    </div>
  )
}

/** One video, however many platforms it went to: its preview in 9:16, its
 *  views (every platform's that is in, added up) and a chip per platform
 *  over the bottom edge. A tap opens it on Instagram when it went there -
 *  "it pops up the link on instagram" - else wherever it has a link; each
 *  chip opens that platform's post. Without any link it is only a picture,
 *  and says nothing about where it would go. */
function Tile({
  video,
  prefix,
  bare = false,
  className = 'w-full rounded-xl',
}: {
  video: CampaignVideo
  prefix?: string
  /** Just the picture - where the views are written beside it. */
  bare?: boolean
  className?: string
}) {
  const primary = video.primary.post
  const url = safe(primary.url)
  const name = [prefix, describeVideo(video), viewsText(video.views)].filter(Boolean).join(', ')
  const caption = firstLine(video.caption)
  const title = [videoDay(video), caption].filter(Boolean).join(' · ') || undefined
  const several = video.posts.length > 1

  return (
    <div
      title={title}
      className={`group relative aspect-[9/16] overflow-hidden border border-edge bg-surface-raised transition-[border-color,transform] duration-200 hover:border-edge-lit has-[>a:active]:scale-[0.97] ${className}`}
    >
      <Preview video={video} bare={bare} />
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
      {bare ? null : (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black/85 via-black/35 to-transparent" />
          <span aria-hidden className="numeric pointer-events-none absolute inset-x-2 bottom-1.5 truncate text-sm font-semibold text-white drop-shadow">
            {video.views === null ? '—' : formatViews(video.views)}
          </span>
          <span className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1">
            {video.posts.map(({ post }) => {
              const link = several ? safe(post.url) : null
              const glyph = <PlatformGlyph platform={post.platform} className="h-3.5 w-3.5" />
              const chip = 'flex size-7 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur-sm'
              return link ? (
                <a
                  key={post.id}
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${post.platform} post, ${viewsText(post.views)}`}
                  title={`${post.platform} · ${viewsText(post.views)}`}
                  className={`${chip} press pointer-events-auto transition-colors duration-200 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
                >
                  {glyph}
                </a>
              ) : (
                <span key={post.id} aria-hidden className={`${chip} opacity-90`}>
                  {glyph}
                </span>
              )
            })}
          </span>
        </>
      )}
    </div>
  )
}

/** The first line of a caption, short. */
function firstLine(caption: string): string {
  const line = caption.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

/** The picture, or the first frame of the video file - never playing. With
 *  no preview at all (Postiz gives none for Instagram), or one that will not
 *  load, a card in the deck's look: its caption's first line, or the day it
 *  went out. */
function Preview({ video, bare }: { video: CampaignVideo; bare: boolean }) {
  const [broken, setBroken] = useState(false)
  const src = video.preview && !broken ? safe(video.preview.src) : null
  const fill = 'absolute inset-0 h-full w-full object-cover'

  if (src && video.preview?.kind === 'video') {
    return (
      <video
        aria-hidden
        // Safari draws no first frame for preload="metadata" without a start time.
        src={src.includes('#') ? src : `${src}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        onError={() => setBroken(true)}
        className={`${fill} pointer-events-none`}
      />
    )
  }
  if (src) {
    return <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={fill} />
  }

  const caption = bare ? '' : firstLine(video.caption)
  const day = video.publishedAt ? localDay(video.publishedAt) : null
  return (
    <span
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 65% at 18% 0%, rgba(101,133,245,0.34) 0%, rgba(29,64,194,0.10) 45%, transparent 70%), linear-gradient(180deg, #181b23 0%, #0d0f13 100%)',
      }}
    >
      <span
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(134,168,255,0.16) 1px, transparent 1px)',
          backgroundSize: '11px 11px',
          maskImage: 'linear-gradient(180deg, black 0%, transparent 60%)',
          WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 60%)',
        }}
      />
      {caption ? (
        <span className="absolute inset-x-2.5 top-11 line-clamp-5 text-[0.8125rem] font-semibold leading-snug text-text/90 [overflow-wrap:anywhere]">
          {caption}
        </span>
      ) : day ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="numeric text-2xl font-bold leading-none text-text">{Number(day.slice(8))}</span>
          <span className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-brand">{dayLabel(day).slice(5, 8)}</span>
        </span>
      ) : null}
    </span>
  )
}
