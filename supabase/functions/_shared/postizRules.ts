// The pure half of reading a user's own Postiz posts (_shared/postizPosts.ts):
// what Postiz's answers mean, which videos are due a views reading, and how
// many requests this hour still allows. No Deno, no fetch, no database, so
// vitest runs it as it is (src/postizRules.test.ts).
//
// The answer's types restate src/sync/postizPosts.ts - Deno cannot import
// across the src/ boundary. The test file holds a compile-time check in both
// directions, so `tsc -b` fails the day the two stop matching.

// --- The answer (mirrors src/sync/postizPosts.ts) ---------------------------

export type PostizPostStatus = 'scheduled' | 'posted' | 'failed'

export interface PostizPostView {
  id: string
  group: string | null
  platform: string
  handle: string
  url: string | null
  preview: string | null
  previewKind: 'image' | 'video' | null
  caption: string
  status: PostizPostStatus
  publishedAt: string | null
  views: number | null
  viewsAt: string | null
}

export interface PostizPostsAnswer {
  connected: boolean
  posts: PostizPostView[]
  reading: number
  error?: string
}

export interface PostizRange {
  from: string
  to: string
}

// --- Numbers ---------------------------------------------------------------

export const POSTIZ_API = 'https://api.postiz.com/public/v1'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Postiz allows 30 requests an hour per key and counts the ones it refuses
 *  too. The planner keeps five back for whatever else uses the key. Shared by
 *  postiz-posts and coach: both spend the same per-user allowance. */
export const PLANNER_POSTIZ_PER_HOUR = 25
/** When the cutter also posts with this key (it keeps its own count in
 *  cutter_config), the planner takes at most this many an hour... */
export const SHARED_POSTIZ_PER_HOUR = 8
/** ...and none once the cutter has used this many of its hour - its own
 *  share for reads (silence-cutter postiz/index.ts POSTIZ_READS). The rest of
 *  its hour is for posting, which must never wait on the planner. */
export const CUTTER_READ_SHARE = 12
/** Views are read one post per request; at most this many in one call. */
export const VIEWS_PER_CALL = 15
/** The account list (handles) is read again after this long. */
export const INTEGRATIONS_FRESH_MS = 12 * HOUR
/** A range's post list is read again after this long. */
export const LIST_FRESH_MS = 15 * MINUTE
/** The longest range one call may ask about. */
export const MAX_RANGE_DAYS = 62
/** TikTok thumbnails (oEmbed) read in one call, at most - they are not
 *  Postiz requests and do not count against its hour. */
export const THUMBS_PER_CALL = 10
/** A TikTok thumbnail is fetched again after this long: the CDN link it
 *  gives expires. */
export const THUMB_FRESH_MS = 24 * HOUR
/** TikTok had no thumbnail (a video just out can be unknown to oEmbed for a
 *  while): asked again after this long. */
export const THUMB_RETRY_MS = 6 * HOUR

/** Hours after it went out that a video's views are read again - the
 *  cutter's schedule (silence-cutter postiz/postViews.ts). */
export const POST_VIEW_AGES_H = [24, 72, 168] as const
/** Past this, a video that has been read once is not read again. */
export const POST_VIEW_MAX_DAYS = 8
/** A video never read is first read this long after it went out: before
 *  that the platform has next to nothing to say, and the request is better
 *  spent on an older video. */
export const FIRST_READ_AFTER_MS = HOUR

// --- The range asked about --------------------------------------------------

/** The range a request names, or why it cannot be used. */
export function checkRange(from: unknown, to: unknown): PostizRange | string {
  const start = typeof from === 'string' ? Date.parse(from) : NaN
  const end = typeof to === 'string' ? Date.parse(to) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'from and to must be ISO times.'
  if (end <= start) return 'to must be after from.'
  if (end - start > MAX_RANGE_DAYS * DAY) return `A range can cover at most ${MAX_RANGE_DAYS} days.`
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
}

/** A range whose list was read, and when. Kept on postiz_state.ranges. */
export interface FetchedRange {
  from: string
  to: string
  at: string
}

/** Whether a list read lately covers this whole range. */
export function rangeFresh(ranges: readonly FetchedRange[], range: PostizRange, now: number): boolean {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  return ranges.some(
    (r) => Date.parse(r.from) <= from && Date.parse(r.to) >= to && now - Date.parse(r.at) < LIST_FRESH_MS,
  )
}

/** The ranges to keep after reading this one: the new one, and the others
 *  still fresh that it does not cover. */
export function rememberRange(ranges: readonly FetchedRange[], range: PostizRange, now: number): FetchedRange[] {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const kept = ranges.filter(
    (r) =>
      now - Date.parse(r.at) < LIST_FRESH_MS && !(Date.parse(r.from) >= from && Date.parse(r.to) <= to),
  )
  return [{ from: range.from, to: range.to, at: new Date(now).toISOString() }, ...kept].slice(0, 12)
}

/** postiz_state.ranges as stored, with anything unreadable dropped. */
export function parseRanges(value: unknown): FetchedRange[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (r): r is FetchedRange =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as FetchedRange).from === 'string' &&
      typeof (r as FetchedRange).to === 'string' &&
      typeof (r as FetchedRange).at === 'string',
  )
}

// --- The hour's allowance ---------------------------------------------------

/** One user's count of Postiz requests this hour (postiz_state). Times in ms. */
export interface Allowance {
  windowStart: number | null
  used: number
  busyUntil: number | null
}

/** The cutter's own count for the same key (cutter_config
 *  `postiz-use:<hash>`), when the cutter posts with it too. */
export interface CutterUse {
  since: number
  used: number
  busyUntil: number
}

export interface Grant {
  /** How many requests may be made now. */
  granted: number
  /** The allowance to store with them taken. */
  next: Allowance
  /** When more can be asked, if fewer than wanted were granted. */
  waitUntil: number | null
}

/** Takes up to `want` requests from this hour. A new hour starts an hour
 *  after the last one began. Nothing at all while Postiz has said "too many"
 *  - a refused question only pushes that further away. */
export function grant(allowance: Allowance, want: number, now: number, cutter: CutterUse | null = null): Grant {
  let { windowStart, used } = allowance
  if (windowStart === null || now - windowStart >= HOUR || now < windowStart) {
    windowStart = now
    used = 0
  }
  const next: Allowance = { windowStart, used, busyUntil: allowance.busyUntil }
  const busyUntil = Math.max(allowance.busyUntil ?? 0, cutter?.busyUntil ?? 0)
  if (now < busyUntil) return { granted: 0, next, waitUntil: busyUntil }

  let room = PLANNER_POSTIZ_PER_HOUR - used
  let resetAt = windowStart + HOUR
  if (cutter) {
    const cutterBusy = now - cutter.since < HOUR && cutter.used >= CUTTER_READ_SHARE
    room = cutterBusy ? 0 : SHARED_POSTIZ_PER_HOUR - used
    if (cutterBusy) resetAt = cutter.since + HOUR
  }
  const granted = Math.max(0, Math.min(Math.floor(want), room))
  next.used = used + granted
  return { granted, next, waitUntil: granted < want ? resetAt : null }
}

/** After Postiz answers 429: nothing more until this hour is out, and at
 *  least a quarter of an hour (as the cutter does). */
export function afterTooMany(allowance: Allowance, now: number): Allowance {
  const start = allowance.windowStart ?? now
  return {
    windowStart: start,
    used: PLANNER_POSTIZ_PER_HOUR,
    busyUntil: Math.max(allowance.busyUntil ?? 0, now + 15 * MINUTE, start + HOUR),
  }
}

/** The cutter's count for a key, from its cutter_config value, or null when
 *  there is none (the cutter does not post with this key). */
export function parseCutterUse(value: unknown): CutterUse | null {
  if (typeof value !== 'string') return null
  try {
    const saved = JSON.parse(value) as Record<string, unknown> | null
    if (!saved || typeof saved !== 'object') return null
    return { since: Number(saved.since) || 0, used: Number(saved.used) || 0, busyUntil: Number(saved.busyUntil) || 0 }
  } catch {
    return null
  }
}

/** The name the cutter files a key's count under: `postiz-use:` and the
 *  first 8 bytes of its SHA-256, in hex (silence-cutter postiz/index.ts
 *  keyIdOf). The same 16 characters fingerprint the key in postiz_state. */
export function keyFingerprint(digest: Uint8Array): string {
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

// --- What Postiz sends ------------------------------------------------------

/** One account (channel) from GET /integrations. */
export interface PostizIntegration {
  id: string
  name: string
  identifier: string
  profile: string
  disabled: boolean
}

export function parseIntegrations(json: unknown): PostizIntegration[] {
  if (!Array.isArray(json)) return []
  return json
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && typeof (i as { id?: unknown }).id === 'string')
    .map((i) => ({
      id: String(i.id),
      name: typeof i.name === 'string' ? i.name : '',
      identifier: typeof i.identifier === 'string' ? i.identifier : '',
      profile: typeof i.profile === 'string' ? i.profile : '',
      disabled: i.disabled === true,
    }))
}

/** One post from GET /posts. The public API selects id, content,
 *  publishDate, releaseURL, releaseId, state, error, group and the
 *  integration (id, providerIdentifier, name, picture) - not the post's media
 *  (`image`), which is read here only in case a later Postiz starts sending
 *  it. */
export interface PostizListedPost {
  id: string
  group?: unknown
  content?: unknown
  publishDate?: unknown
  releaseURL?: unknown
  state?: unknown
  image?: unknown
  integration?: { id?: unknown; providerIdentifier?: unknown; name?: unknown } | null
}

export function parsePostList(json: unknown): PostizListedPost[] {
  const posts = json && typeof json === 'object' ? (json as { posts?: unknown }).posts : null
  if (!Array.isArray(posts)) return []
  const seen = new Set<string>()
  const out: PostizListedPost[] = []
  // A repeating post comes back once per time it goes out in the range, under
  // one id. The first (earliest) stands for it.
  for (const p of posts) {
    if (!p || typeof p !== 'object' || typeof (p as { id?: unknown }).id !== 'string') continue
    const post = p as PostizListedPost
    if (seen.has(post.id)) continue
    seen.add(post.id)
    out.push(post)
  }
  return out
}

/** Postiz's state as the planner says it. A draft is not going out, so it is
 *  not a post here at all. */
export function statusOf(state: unknown): PostizPostStatus | null {
  switch (typeof state === 'string' ? state.trim().toUpperCase() : '') {
    case 'QUEUE':
      return 'scheduled'
    case 'PUBLISHED':
      return 'posted'
    case 'ERROR':
      return 'failed'
    default:
      return null
  }
}

const PLATFORM_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  snapchat: 'Snapchat',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
}

/** The planner's platform name for a Postiz provider identifier:
 *  'instagram-standalone' is Instagram, 'linkedin-page' is LinkedIn. One it
 *  does not know keeps Postiz's own word. */
export function plannerPlatform(identifier: unknown): string {
  const raw = typeof identifier === 'string' ? identifier.trim().toLowerCase() : ''
  const root = raw.split(/[-_]/)[0]
  return PLATFORM_NAMES[root] ?? raw
}

/** A handle without the @. */
export function cleanHandle(profile: unknown): string {
  return typeof profile === 'string' ? profile.trim().replace(/^@+/, '') : ''
}

/** Postiz keeps a caption as the editor's HTML; the planner shows text. */
export function plainCaption(content: unknown): string {
  if (typeof content !== 'string') return ''
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000)
}

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return /^https?:\/\/\S+$/i.test(v) && v.length <= 2000 ? v : null
}

/** The video's id in a YouTube link (watch, shorts, youtu.be, embed). */
export function youtubeId(url: string | null): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^(www\.|m\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = parsed.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') id = parsed.searchParams.get('v')
    else {
      const match = parsed.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/)
      id = match ? match[2] : null
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null
}

export interface Preview {
  url: string
  kind: 'image' | 'video'
}

const VIDEO_FILE = /\.(mp4|mov|m4v|webm)(\?|#|$)/i

/** What to show for a post: its own media when Postiz sends it (a video
 *  thumbnail, else the file - 'video' for a video file, 'image' otherwise);
 *  else YouTube's thumbnail for the video id in its link; else nothing.
 *  Instagram and TikTok pages are never fetched for one. */
export function previewOf(post: Pick<PostizListedPost, 'image' | 'releaseURL'>): Preview | null {
  let media: unknown = post.image
  if (typeof media === 'string') {
    try {
      media = JSON.parse(media)
    } catch {
      media = null
    }
  }
  if (Array.isArray(media)) {
    for (const item of media) {
      if (!item || typeof item !== 'object') continue
      const { path, thumbnail } = item as { path?: unknown; thumbnail?: unknown }
      const thumb = httpUrl(thumbnail)
      if (thumb) return { url: thumb, kind: VIDEO_FILE.test(thumb) ? 'video' : 'image' }
      const file = httpUrl(path)
      if (file) return { url: file, kind: VIDEO_FILE.test(file) ? 'video' : 'image' }
    }
  }
  const id = youtubeId(httpUrl(post.releaseURL))
  return id ? { url: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, kind: 'image' } : null
}

// --- The cache (postiz_posts) -----------------------------------------------

/** A postiz_posts row. Times are ISO strings, as PostgREST gives them. */
export interface CachedPost {
  post_id: string
  /** Postiz's group - one video sent to several accounts at once. */
  post_group: string | null
  integration_id: string | null
  platform: string
  handle: string
  release_url: string | null
  preview_url: string | null
  preview_kind: 'image' | 'video' | null
  caption: string
  published_at: string | null
  status: PostizPostStatus
  views: number | null
  views_at: string | null
  views_checked_at: string | null
  /** A TikTok video's thumbnail from TikTok's oEmbed, and when it was asked
   *  for (thumb_url null with a time: TikTok had none). */
  thumb_url: string | null
  thumb_at: string | null
}

/** The columns a list read writes. Views and the TikTok thumbnail are left
 *  out on purpose, so an upsert never wipes a reading. */
export type ListedColumns = Omit<CachedPost, 'views' | 'views_at' | 'views_checked_at' | 'thumb_url' | 'thumb_at'>

/** A listed post as cache columns, or null for one the planner does not keep
 *  (a draft, or one with no state it knows). */
export function toListedColumns(post: PostizListedPost, integrations: readonly PostizIntegration[]): ListedColumns | null {
  const status = statusOf(post.state)
  if (!status) return null
  const integrationId = typeof post.integration?.id === 'string' ? post.integration.id : null
  const account = integrationId ? integrations.find((i) => i.id === integrationId) : undefined
  const at = typeof post.publishDate === 'string' ? Date.parse(post.publishDate) : NaN
  const preview = previewOf(post)
  return {
    post_id: post.id,
    post_group: typeof post.group === 'string' && post.group.trim() !== '' ? post.group.trim() : null,
    integration_id: integrationId,
    platform: plannerPlatform(post.integration?.providerIdentifier ?? account?.identifier),
    handle: cleanHandle(account?.profile),
    release_url: httpUrl(post.releaseURL),
    preview_url: preview?.url ?? null,
    preview_kind: preview?.kind ?? null,
    caption: plainCaption(post.content),
    published_at: Number.isFinite(at) ? new Date(at).toISOString() : null,
    status,
  }
}

/** Integration ids the posts name that the account list does not have - a
 *  channel connected since the list was read. */
export function unknownIntegrations(posts: readonly PostizListedPost[], integrations: readonly PostizIntegration[]): string[] {
  const known = new Set(integrations.map((i) => i.id))
  const missing = new Set<string>()
  for (const p of posts) {
    const id = p.integration?.id
    if (typeof id === 'string' && !known.has(id)) missing.add(id)
  }
  return [...missing]
}

// --- TikTok thumbnails -------------------------------------------------------
//
// Postiz's list has no media, so a TikTok video's picture comes from TikTok's
// public oEmbed endpoint (https://www.tiktok.com/oembed?url=<link>) - no key,
// made for embedding. Its thumbnail_url is a signed CDN link that expires, so
// it is asked for again after a day, or sooner when the link says it expires.
// Instagram has no token-free official source and stays without a preview;
// no page is ever scraped.

/** A link TikTok's oEmbed takes: a video on tiktok.com, over https. */
export function isTikTokVideo(url: string | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && /(^|\.)tiktok\.com$/.test(parsed.hostname) && /\/video\/\d+/.test(parsed.pathname)
  } catch {
    return false
  }
}

export function oembedUrl(videoUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`
}

/** The thumbnail in an oEmbed answer, or null. */
export function oembedThumbnail(json: unknown): string | null {
  return json && typeof json === 'object' ? httpUrl((json as { thumbnail_url?: unknown }).thumbnail_url) : null
}

/** When a signed TikTok CDN link stops working (its x-expires, in seconds),
 *  or null when it does not say. */
export function thumbExpiry(url: string | null): number | null {
  if (!url) return null
  try {
    const seconds = Number(new URL(url).searchParams.get('x-expires'))
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
  } catch {
    return null
  }
}

/** Whether a TikTok video's thumbnail should be asked for now: posted, a
 *  TikTok video link, and never asked, asked over a day ago (six hours when
 *  TikTok had none), or its link expiring within the hour. */
export function thumbDue(post: Pick<CachedPost, 'status' | 'release_url' | 'thumb_url' | 'thumb_at'>, now: number): boolean {
  if (post.status !== 'posted' || !isTikTokVideo(post.release_url)) return false
  const at = post.thumb_at ? Date.parse(post.thumb_at) : NaN
  if (!Number.isFinite(at) || now - at >= (post.thumb_url ? THUMB_FRESH_MS : THUMB_RETRY_MS)) return true
  const expires = thumbExpiry(post.thumb_url)
  return expires !== null && now >= expires - HOUR
}

/** Which thumbnails to ask for, newest video first, at most `limit`. */
export function pickThumbs<T extends Pick<CachedPost, 'status' | 'release_url' | 'thumb_url' | 'thumb_at' | 'published_at'>>(
  posts: readonly T[],
  now: number,
  limit: number,
): T[] {
  return posts
    .filter((p) => thumbDue(p, now))
    .sort((a, b) => (Date.parse(b.published_at ?? '') || 0) - (Date.parse(a.published_at ?? '') || 0))
    .slice(0, Math.max(0, limit))
}

// --- Views ------------------------------------------------------------------

/** Whether a video is due a views reading now: out, and either never asked
 *  (from an hour after it went out, whatever its age - a student who connects
 *  Postiz today still gets last week's numbers), or past a day, three days
 *  or a week and not asked since - until eight days. */
export function viewsDue(post: Pick<CachedPost, 'status' | 'published_at' | 'views_checked_at'>, now: number): boolean {
  if (post.status !== 'posted' || !post.published_at) return false
  const at = Date.parse(post.published_at)
  if (!Number.isFinite(at) || at > now) return false
  if (!post.views_checked_at) return now - at >= FIRST_READ_AFTER_MS
  if (now - at > POST_VIEW_MAX_DAYS * DAY) return false
  const last = Date.parse(post.views_checked_at)
  return POST_VIEW_AGES_H.some((hours) => {
    const due = at + hours * HOUR
    return now >= due && !(last >= due)
  })
}

/** Whether a video still has no number and will be asked for one. */
export function awaitingViews(post: Pick<CachedPost, 'status' | 'published_at' | 'views' | 'views_checked_at'>, now: number): boolean {
  if (post.status !== 'posted' || post.views !== null || !post.published_at) return false
  const at = Date.parse(post.published_at)
  if (!Number.isFinite(at)) return false
  return !post.views_checked_at || now - at <= POST_VIEW_MAX_DAYS * DAY
}

/** Which due videos to read first, at most `limit`: ones never asked (newest
 *  first), then the longest since asked. */
export function pickDue<T extends Pick<CachedPost, 'status' | 'published_at' | 'views_checked_at'>>(
  posts: readonly T[],
  now: number,
  limit: number,
): T[] {
  const due = posts.filter((p) => viewsDue(p, now))
  const never = due.filter((p) => !p.views_checked_at).sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))
  const again = due
    .filter((p) => p.views_checked_at)
    .sort((a, b) => Date.parse(a.views_checked_at!) - Date.parse(b.views_checked_at!))
  return [...never, ...again].slice(0, Math.max(0, limit))
}

/** One of the numbers Postiz gives for a post, day by day or as one total. */
interface PostizMetric {
  label?: unknown
  data?: { total?: unknown; date?: unknown }[]
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** What views Postiz gives for one post (GET /analytics/post/:id). Its
 *  answer is a list of metrics like an account's (views first, else plays,
 *  else impressions) - each a series of days, either running totals (the last
 *  one) or day by day (added up) - or an object with a views number. Null
 *  when it says nothing usable, `{ missing: true }` included.
 *
 *  Copied from silence-cutter supabase/functions/postiz/postViews.ts
 *  (postViewCount), where it was worked out against Postiz's real answers.
 *  Change both together. */
export function postViewCount(answer: unknown): number | null {
  if (Array.isArray(answer)) {
    const list = answer as PostizMetric[]
    const labelled = (...names: string[]) =>
      list.find((m) => typeof m.label === 'string' && names.includes(m.label.trim().toLowerCase()))
    const m = labelled('views', 'video views', 'video_views', 'plays', 'video plays') ?? labelled('impressions', 'reach')
    const days = (m?.data ?? [])
      .filter((d) => num(d.total) !== null)
      .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
      .map((d) => num(d.total)!)
    if (days.length === 0) return null
    const running = days.length > 1 && days.every((v, i) => i === 0 || v >= days[i - 1])
    return Math.round(running ? days[days.length - 1] : days.reduce((a, b) => a + b, 0))
  }
  if (answer && typeof answer === 'object') {
    const fields = answer as Record<string, unknown>
    for (const key of ['views', 'viewCount', 'videoViews', 'plays', 'playCount', 'impressions']) {
      const n = num(fields[key])
      if (n !== null) return Math.round(n)
    }
  }
  return null
}

// --- The answer -------------------------------------------------------------

const iso = (value: string | null): string | null => {
  if (!value) return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

/** The preview to show: the post's own (from Postiz), else its TikTok
 *  thumbnail while that link still works. */
function previewFor(row: CachedPost, now: number): { preview: string | null; previewKind: 'image' | 'video' | null } {
  if (row.preview_url) return { preview: row.preview_url, previewKind: row.preview_kind ?? 'image' }
  const expires = thumbExpiry(row.thumb_url)
  if (row.thumb_url && (expires === null || now < expires)) return { preview: row.thumb_url, previewKind: 'image' }
  return { preview: null, previewKind: null }
}

export function toView(row: CachedPost, now: number = Date.now()): PostizPostView {
  return {
    id: row.post_id,
    group: row.post_group ?? null,
    platform: row.platform,
    handle: row.handle,
    url: row.release_url,
    ...previewFor(row, now),
    caption: row.caption,
    status: row.status,
    publishedAt: iso(row.published_at),
    views: row.views === null || row.views === undefined ? null : Number(row.views),
    viewsAt: row.views === null || row.views === undefined ? null : iso(row.views_at),
  }
}

/** The cached posts that go (or went) out in the range, newest first, and
 *  how many of them are still waiting for a number. */
export function answerFrom(rows: readonly CachedPost[], range: PostizRange, now: number, error?: string): PostizPostsAnswer {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  const inRange = rows.filter((r) => {
    const at = r.published_at ? Date.parse(r.published_at) : NaN
    return Number.isFinite(at) && at >= from && at < to
  })
  inRange.sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))
  const answer: PostizPostsAnswer = {
    connected: true,
    posts: inRange.map((r) => toView(r, now)),
    reading: inRange.filter((r) => awaitingViews(r, now)).length,
  }
  if (error) answer.error = error
  return answer
}

/** What a failed Postiz request means, in plain words. */
export function postizProblem(status: number, said: string | null): string {
  if (status === 401 || status === 403) {
    return said && /subscription/i.test(said)
      ? 'Postiz says this account has no subscription, so its posts cannot be read.'
      : "Postiz didn't accept your saved key. Paste it again in Setup (Postiz: Settings, then Public API)."
  }
  if (status === 429) return 'Postiz says too many requests for this key this hour. Posts and views catch up within the hour.'
  if (status >= 500) return `Postiz had a problem (${status}). Showing what was read before.`
  return `Postiz said: ${said || status}`
}

/** Postiz's own message in an error body, when it has one. */
export function postizMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const { message, msg } = json as { message?: unknown; msg?: unknown }
  const said = message ?? msg
  if (Array.isArray(said)) return said.map(String).join('; ')
  return typeof said === 'string' ? said : null
}
