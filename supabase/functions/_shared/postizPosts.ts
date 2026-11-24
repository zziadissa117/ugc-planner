// A user's own Postiz posts, read with the key they saved in SETUP: each
// video's live link, a preview, its views. Used by `postiz-posts` (the
// caller's own) and `coach` (a student's, for the owner). Contract:
// src/sync/postizPosts.ts; design: docs/POSTIZ_AND_COACH.md.
//
// Postiz allows 30 requests an hour per key, counts the ones it refuses, and
// reads views one post at a time. So nothing here asks Postiz more than it
// must:
//   * the key comes from the vault (get_ai_key, provider 'postiz') for this
//     one request and is never returned or stored anywhere else - only a
//     16-character SHA-256 fingerprint, to notice when it is replaced;
//   * what was read is kept (postiz_posts, postiz_state - server only,
//     docs/migrations/0026_postiz_posts.sql): the account list for 12 hours,
//     a range's post list for 15 minutes, each video's views until its next
//     reading is due (a day, three days and a week after it went out - the
//     cutter's schedule);
//   * every request is taken from one per-user allowance first (25 an hour,
//     fewer when the cutter posts with the same key), and after a 429 nothing
//     is asked until the hour is out.
// A call reads at most 15 videos' views; `reading` says how many in the range
// still wait for a number. A number is never guessed: views stay null until
// Postiz gives one.
//
// Postiz's list carries no media, so a posted TikTok video's preview comes
// from TikTok's public oEmbed (no key, not Postiz, not counted): at most 10 a
// call, refreshed after a day because the CDN link expires. A failure there
// only leaves the preview empty. Instagram has no token-free source and stays
// without one.
//
// The rules are in postizRules.ts (pure, tested under vitest). This file is
// the fetching and the database.

import { serviceClient } from './claude.ts'
import {
  type Allowance,
  type CachedPost,
  type CutterUse,
  type ListedColumns,
  type PostizListedPost,
  type PostizPostsAnswer,
  type PostizRange,
  INTEGRATIONS_FRESH_MS,
  POSTIZ_API,
  THUMBS_PER_CALL,
  VIEWS_PER_CALL,
  afterTooMany,
  answerFrom,
  grant,
  keyFingerprint,
  parseCutterUse,
  parseIntegrations,
  parsePostList,
  parseRanges,
  oembedThumbnail,
  oembedUrl,
  pickDue,
  pickThumbs,
  postViewCount,
  postizMessage,
  postizProblem,
  rangeFresh,
  rememberRange,
  toListedColumns,
  unknownIntegrations,
} from './postizRules.ts'

export type { PostizPostsAnswer, PostizRange } from './postizRules.ts'

type Db = ReturnType<typeof serviceClient>

const LIST_TIMEOUT_MS = 30_000
const VIEW_TIMEOUT_MS = 15_000
/** Views are read a few at a time, and no new ones are started after this:
 *  someone is waiting on the screen. */
const VIEW_CONCURRENCY = 5
const READ_BUDGET_MS = 20_000
const THUMB_TIMEOUT_MS = 5_000
const THUMB_CONCURRENCY = 5

const HOUR_USED_UP =
  "This hour's Postiz requests for your key are used up, so the newest posts may be missing. They catch up within the hour."

const POST_COLUMNS =
  'post_id, post_group, integration_id, platform, handle, release_url, preview_url, preview_kind, caption, published_at, status, views, views_at, views_checked_at, thumb_url, thumb_at'

interface StateRow {
  user_id: string
  key_hash: string | null
  integrations: unknown
  integrations_at: string | null
  ranges: unknown
  window_start: string | null
  used: number
  busy_until: string | null
  version: number
}

/** A Postiz request that did not answer 2xx, or could not be made. */
class PostizFailure extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'PostizFailure'
    this.status = status
  }
}

async function postizGet(key: string, path: string, timeoutMs: number): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${POSTIZ_API}${path}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new PostizFailure(
      `Postiz could not be reached (${error instanceof Error ? error.message : String(error)}). Showing what was read before.`,
      null,
    )
  }
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (response.ok) return json
  throw new PostizFailure(postizProblem(response.status, postizMessage(json) ?? text.slice(0, 200)), response.status)
}

const ms = (value: string | null): number | null => {
  if (!value) return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? at : null
}
const isoOrNull = (value: number | null): string | null => (value === null ? null : new Date(value).toISOString())

function allowanceOf(row: StateRow): Allowance {
  return { windowStart: ms(row.window_start), used: Number(row.used) || 0, busyUntil: ms(row.busy_until) }
}

function allowanceColumns(a: Allowance) {
  return { window_start: isoOrNull(a.windowStart), used: a.used, busy_until: isoOrNull(a.busyUntil) }
}

async function readState(db: Db, userId: string): Promise<StateRow | null> {
  const { data, error } = await db.from('postiz_state').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(`postiz_state: ${error.message}`)
  return data as StateRow | null
}

/** This user's state, made on first use. A different key than last time
 *  (a new fingerprint) starts over: the cache belonged to the old key's
 *  Postiz, and so did its hour. */
async function stateFor(db: Db, userId: string, fingerprint: string): Promise<StateRow> {
  let state = await readState(db, userId)
  if (!state) {
    const { error } = await db
      .from('postiz_state')
      .upsert({ user_id: userId, key_hash: fingerprint }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (error) throw new Error(`postiz_state: ${error.message}`)
    state = await readState(db, userId)
    if (!state) throw new Error('postiz_state: the row could not be made.')
  }
  if (state.key_hash === fingerprint) return state

  const { error: wipe } = await db.from('postiz_posts').delete().eq('user_id', userId)
  if (wipe) throw new Error(`postiz_posts: ${wipe.message}`)
  const fresh = {
    key_hash: fingerprint,
    integrations: null,
    integrations_at: null,
    ranges: [],
    window_start: null,
    used: 0,
    busy_until: null,
    version: (Number(state.version) || 0) + 1,
    updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('postiz_state').update(fresh).eq('user_id', userId)
  if (error) throw new Error(`postiz_state: ${error.message}`)
  return { ...state, ...fresh }
}

/** The cutter's own count for this key, when it posts with it too. Read
 *  only - the planner never writes the cutter's tables. */
async function cutterUseFor(db: Db, fingerprint: string): Promise<CutterUse | null> {
  try {
    const { data } = await db.from('cutter_config').select('value').eq('key', `postiz-use:${fingerprint}`).maybeSingle()
    return parseCutterUse((data as { value?: unknown } | null)?.value)
  } catch {
    return null
  }
}

/** Takes up to `want` of this hour's requests. Race-safe: the row's version
 *  must not have moved between reading and writing, or it is read again -
 *  the Today screen asks for today and for the week at the same moment. */
async function take(db: Db, userId: string, want: number, cutter: CutterUse | null): Promise<{ granted: number; busy: boolean }> {
  if (want <= 0) return { granted: 0, busy: false }
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await readState(db, userId)
    if (!row) return { granted: 0, busy: false }
    const now = Date.now()
    const allowance = allowanceOf(row)
    const result = grant(allowance, want, now, cutter)
    const busy = result.granted === 0 && now < Math.max(allowance.busyUntil ?? 0, cutter?.busyUntil ?? 0)
    if (result.granted === 0) return { granted: 0, busy }
    const { data, error } = await db
      .from('postiz_state')
      .update({ ...allowanceColumns(result.next), version: row.version + 1, updated_at: new Date(now).toISOString() })
      .eq('user_id', userId)
      .eq('version', row.version)
      .select('user_id')
    if (error) throw new Error(`postiz_state: ${error.message}`)
    if (data && data.length > 0) return { granted: result.granted, busy: false }
  }
  return { granted: 0, busy: false }
}

/** Postiz said 429: nothing more for this key until the hour is out. */
async function markBusy(db: Db, userId: string): Promise<void> {
  try {
    const row = await readState(db, userId)
    if (!row) return
    const now = Date.now()
    await db
      .from('postiz_state')
      .update({ ...allowanceColumns(afterTooMany(allowanceOf(row), now)), version: row.version + 1, updated_at: new Date(now).toISOString() })
      .eq('user_id', userId)
  } catch {
    // The next 429 says it again.
  }
}

/** Every request of one call, taken from the allowance as it is needed. */
class Spender {
  private budget = 0
  busy = false
  constructor(
    private readonly db: Db,
    private readonly userId: string,
    private readonly cutter: CutterUse | null,
  ) {}

  async reserve(want: number): Promise<number> {
    const { granted, busy } = await take(this.db, this.userId, want, this.cutter)
    this.budget += granted
    if (busy) this.busy = true
    return granted
  }

  async one(): Promise<boolean> {
    if (this.budget === 0) await this.reserve(1)
    if (this.budget === 0) return false
    this.budget -= 1
    return true
  }
}

async function cachedInRange(db: Db, userId: string, range: PostizRange): Promise<CachedPost[]> {
  const { data, error } = await db
    .from('postiz_posts')
    .select(POST_COLUMNS)
    .eq('user_id', userId)
    .gte('published_at', range.from)
    .lt('published_at', range.to)
    .order('published_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`postiz_posts: ${error.message}`)
  return (data ?? []) as CachedPost[]
}

/** Keeps a range's list as Postiz has it now: every post upserted (views
 *  untouched), and the ones it no longer has in that range removed. */
async function saveList(db: Db, userId: string, range: PostizRange, columns: ListedColumns[]): Promise<void> {
  const now = new Date().toISOString()
  if (columns.length > 0) {
    const { error } = await db
      .from('postiz_posts')
      .upsert(
        columns.map((c) => ({ ...c, user_id: userId, updated_at: now })),
        { onConflict: 'user_id,post_id' },
      )
    if (error) throw new Error(`postiz_posts: ${error.message}`)
  }
  let gone = db.from('postiz_posts').delete().eq('user_id', userId).gte('published_at', range.from).lte('published_at', range.to)
  if (columns.length > 0) {
    gone = gone.not('post_id', 'in', `(${columns.map((c) => `"${c.post_id.replace(/["\\]/g, '')}"`).join(',')})`)
  }
  const { error } = await gone
  if (error) throw new Error(`postiz_posts: ${error.message}`)
}

/** Reads one video's views, if no other call is reading it this moment.
 *  Returns the failure that should stop the round, if any. */
async function readViews(db: Db, userId: string, key: string, row: CachedPost): Promise<PostizFailure | null> {
  const askedAt = new Date().toISOString()
  // Claimed first: views_checked_at moves only if nobody else moved it since
  // this row was read, so two calls at once never read the same video.
  let claim = db
    .from('postiz_posts')
    .update({ views_checked_at: askedAt, updated_at: askedAt })
    .eq('user_id', userId)
    .eq('post_id', row.post_id)
  claim = row.views_checked_at ? claim.eq('views_checked_at', row.views_checked_at) : claim.is('views_checked_at', null)
  const { data: claimed, error: claimError } = await claim.select('post_id')
  if (claimError || !claimed || claimed.length === 0) return null

  try {
    const answer = await postizGet(key, `/analytics/post/${encodeURIComponent(row.post_id)}?date=30`, VIEW_TIMEOUT_MS)
    const count = postViewCount(answer)
    row.views_checked_at = askedAt
    if (count !== null) {
      const { error } = await db
        .from('postiz_posts')
        .update({ views: count, views_at: askedAt, updated_at: askedAt })
        .eq('user_id', userId)
        .eq('post_id', row.post_id)
      if (!error) {
        row.views = count
        row.views_at = askedAt
      }
    }
    return null
  } catch (error) {
    const failure = error instanceof PostizFailure ? error : new PostizFailure(String(error), null)
    const aboutThisPost = failure.status !== null && failure.status >= 400 && failure.status < 500 && ![401, 403, 429].includes(failure.status)
    if (aboutThisPost) {
      // Postiz has nothing to read for this one (yet): asked, read again at
      // its next age.
      row.views_checked_at = askedAt
      return null
    }
    // Not this video's fault - give the claim back so it is read next time.
    await db
      .from('postiz_posts')
      .update({ views_checked_at: row.views_checked_at })
      .eq('user_id', userId)
      .eq('post_id', row.post_id)
      .eq('views_checked_at', askedAt)
    return failure
  }
}

/** One TikTok video's thumbnail from oEmbed. A clear "no" from TikTok (a
 *  4xx: the video is private or gone) is kept as asked-with-nothing; anything
 *  else (timeout, 5xx) leaves it to be asked next time. Never throws. */
async function readThumb(db: Db, userId: string, row: CachedPost): Promise<void> {
  try {
    const response = await fetch(oembedUrl(row.release_url!), { signal: AbortSignal.timeout(THUMB_TIMEOUT_MS) })
    if (!response.ok && (response.status < 400 || response.status >= 500 || response.status === 429)) return
    const thumb = response.ok ? oembedThumbnail(await response.json().catch(() => null)) : null
    const at = new Date().toISOString()
    const { error } = await db
      .from('postiz_posts')
      .update({ thumb_url: thumb, thumb_at: at })
      .eq('user_id', userId)
      .eq('post_id', row.post_id)
    if (!error) {
      row.thumb_url = thumb
      row.thumb_at = at
    }
  } catch {
    // No preview this time.
  }
}

async function readThumbs(db: Db, userId: string, rows: CachedPost[]): Promise<void> {
  const due = pickThumbs(rows, Date.now(), THUMBS_PER_CALL)
  for (let i = 0; i < due.length; i += THUMB_CONCURRENCY) {
    await Promise.all(due.slice(i, i + THUMB_CONCURRENCY).map((row) => readThumb(db, userId, row)))
  }
}

async function readWithKey(db: Db, userId: string, key: string, range: PostizRange): Promise<PostizPostsAnswer> {
  const fingerprint = keyFingerprint(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))))
  const state = await stateFor(db, userId, fingerprint)
  const spend = new Spender(db, userId, await cutterUseFor(db, fingerprint))
  let problem: string | undefined

  const fail = async (failure: PostizFailure) => {
    if (failure.status === 429) await markBusy(db, userId)
    problem = failure.message
  }

  // 1. The post list for the range, and the account list when it is stale
  //    or a post names an account it does not have.
  const start = Date.now()
  let integrations = parseIntegrations(state.integrations)
  const integrationsAt = ms(state.integrations_at)
  let integrationsStale = integrationsAt === null || start - integrationsAt >= INTEGRATIONS_FRESH_MS
  const listStale = !rangeFresh(parseRanges(state.ranges), range, start)
  await spend.reserve((listStale ? 1 : 0) + (integrationsStale ? 1 : 0))

  let listed: PostizListedPost[] | null = null
  if (listStale) {
    if (await spend.one()) {
      const query = `?startDate=${encodeURIComponent(range.from)}&endDate=${encodeURIComponent(range.to)}`
      try {
        listed = parsePostList(await postizGet(key, `/posts${query}`, LIST_TIMEOUT_MS))
      } catch (error) {
        await fail(error instanceof PostizFailure ? error : new PostizFailure(String(error), null))
      }
    } else {
      problem = spend.busy ? postizProblem(429, null) : HOUR_USED_UP
    }
  }

  if (!problem && listed && unknownIntegrations(listed, integrations).length > 0) integrationsStale = true
  if (!problem && integrationsStale && (await spend.one())) {
    try {
      integrations = parseIntegrations(await postizGet(key, '/integrations', LIST_TIMEOUT_MS))
      const { error } = await db
        .from('postiz_state')
        .update({ integrations, integrations_at: new Date().toISOString() })
        .eq('user_id', userId)
      if (error) throw new Error(`postiz_state: ${error.message}`)
    } catch (error) {
      if (!(error instanceof PostizFailure)) throw error
      await fail(error)
    }
  }

  if (listed) {
    const columns = listed.map((p) => toListedColumns(p, integrations)).filter((c): c is ListedColumns => c !== null)
    await saveList(db, userId, range, columns)
    const { error } = await db
      .from('postiz_state')
      .update({ ranges: rememberRange(parseRanges(state.ranges), range, Date.now()) })
      .eq('user_id', userId)
    if (error) throw new Error(`postiz_state: ${error.message}`)
  }

  // 2. Views for the videos in the range that are due one, and TikTok
  //    thumbnails alongside (not Postiz, so whatever Postiz said).
  const rows = await cachedInRange(db, userId, range)
  const thumbs = readThumbs(db, userId, rows).catch(() => {})
  if (!problem) {
    const due = pickDue(rows, Date.now(), VIEWS_PER_CALL)
    const granted = due.length > 0 ? await spend.reserve(due.length) : 0
    const batch = due.slice(0, granted)
    const began = Date.now()
    for (let i = 0; i < batch.length; i += VIEW_CONCURRENCY) {
      if (Date.now() - began > READ_BUDGET_MS) break
      const failures = (await Promise.all(batch.slice(i, i + VIEW_CONCURRENCY).map((row) => readViews(db, userId, key, row)))).filter(
        (f): f is PostizFailure => f !== null,
      )
      if (failures.length > 0) {
        await fail(failures.find((f) => f.status === 429) ?? failures[0])
        break
      }
    }
  }

  await thumbs
  return answerFrom(rows, range, Date.now(), problem)
}

/** This user's Postiz posts in the range. Never throws: whatever goes wrong
 *  is said in `error`, with what was read before. */
export async function readPostizPosts(userId: string, range: PostizRange): Promise<PostizPostsAnswer> {
  const db = serviceClient()
  const { data: key, error } = await db.rpc('get_ai_key', { p_user: userId, p_provider: 'postiz' })
  if (error) return { connected: false, posts: [], reading: 0, error: 'Your saved Postiz key could not be read. Try again.' }
  if (typeof key !== 'string' || key === '') return { connected: false, posts: [], reading: 0 }
  try {
    return await readWithKey(db, userId, key, range)
  } catch (failure) {
    // The cache itself failed - most likely 0026_postiz_posts.sql has not
    // been run on this project.
    return {
      connected: true,
      posts: [],
      reading: 0,
      error: `Postiz posts could not be loaded (${failure instanceof Error ? failure.message : String(failure)}).`,
    }
  }
}

/** Drops what was read with this user's Postiz key (when the key is
 *  removed). The hour's count and the fingerprint stay: removing and pasting
 *  the same key again must not hand it a fresh hour Postiz would not. Best
 *  effort - if it fails, the cache is only stale. */
export async function forgetPostiz(userId: string): Promise<void> {
  const db = serviceClient()
  await db.from('postiz_posts').delete().eq('user_id', userId)
  await db.from('postiz_state').update({ integrations: null, integrations_at: null, ranges: [] }).eq('user_id', userId)
}
