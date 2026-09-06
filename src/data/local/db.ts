// The Dexie database. Table names and column names mirror docs/schema.sql
// exactly, so the eventual SupabaseAdapter needs no translation layer and a
// row can move between the two stores unchanged.
//
// Dexie index strings list only the columns that are indexed, not every column
// - the rest of the row is stored regardless. `&` marks a unique index and `[a+b]`
// a compound one; those are how the SQL's UNIQUE constraints get enforced
// locally, since IndexedDB has no other notion of them.
//
// Nothing outside src/data imports this file.

import Dexie, { type EntityTable, type Transaction } from 'dexie'

import type {
  BonusClaim,
  BonusTier,
  Campaign,
  CampaignAccount,
  CampaignAngle,
  CampaignDocument,
  CampaignField,
  CampaignRule,
  CampaignHook,
  PhaseEvent,
  TableName,
  TimeEstimate,
  UserSettings,
  Video,
  VideoPost,
  WarmupEvent,
  WorkSession,
} from '../schema'

/** A write waiting to go to the server.
 *
 *  Not a mirrored table: it exists only on the client and is never synced or
 *  exported. Named with a leading underscore so it cannot be mistaken for one
 *  of the schema.sql tables.
 *
 *  Every write enqueues one of these from day one. Phase 9 adds the drain; the
 *  point of having it now is that no write path has to be rewritten to become
 *  local-first later - they already are. */
export interface OutboxEntry {
  id: number
  table_name: TableName
  /** Primary key of the affected row. Composite for user_settings, which is
   *  keyed by user_id. */
  row_id: string
  op: 'insert' | 'update' | 'delete'
  /** The row as it stood after the write. Sync sends this, not a diff, because
   *  a diff against a server state we have not seen is not a thing we can
   *  compute offline. */
  payload: unknown
  queued_at: string
  /** Bumped by the drain when the server rejects transiently. */
  attempts: number
  /** Why the last attempt failed, kept so a stuck queue can say what is wrong
   *  rather than only that something is. */
  last_error?: string | null
}

export class LocalDatabase extends Dexie {
  campaigns!: EntityTable<Campaign, 'id'>
  campaign_accounts!: EntityTable<CampaignAccount, 'id'>
  campaign_documents!: EntityTable<CampaignDocument, 'id'>
  campaign_fields!: EntityTable<CampaignField, 'id'>
  campaign_angles!: EntityTable<CampaignAngle, 'id'>
  campaign_hooks!: EntityTable<CampaignHook, 'id'>
  campaign_rules!: EntityTable<CampaignRule, 'id'>
  videos!: EntityTable<Video, 'id'>
  video_posts!: EntityTable<VideoPost, 'id'>
  phase_events!: EntityTable<PhaseEvent, 'id'>
  work_sessions!: EntityTable<WorkSession, 'id'>
  warmup_events!: EntityTable<WarmupEvent, 'id'>
  bonus_tiers!: EntityTable<BonusTier, 'id'>
  bonus_claims!: EntityTable<BonusClaim, 'id'>
  time_estimates!: EntityTable<TimeEstimate, 'id'>
  user_settings!: EntityTable<UserSettings, 'user_id'>
  _outbox!: EntityTable<OutboxEntry, 'id'>

  constructor(name = 'ugc-planner') {
    super(name)

    this.version(1).stores({
      campaigns: 'id, user_id, is_active, name',
      campaign_documents: 'id, campaign_id, kind',
      // The SQL's `unique (campaign_id, field_key)`.
      campaign_fields: 'id, campaign_id, &[campaign_id+field_key], source',
      campaign_angles: 'id, campaign_id, is_verified, sort_order',
      campaign_rules: 'id, campaign_id, sort_order',
      // Indexed the way the NOW screen reads: by phase, by campaign and phase,
      // and by the day a video is owed for.
      videos: 'id, campaign_id, phase, [campaign_id+phase], owed_for_date, kind',
      // The SQL's `unique (video_id, platform)`. One piece of content on two
      // platforms is two rows here and still one deliverable.
      video_posts: 'id, video_id, &[video_id+platform]',
      // ++id gives the auto-incrementing key that bigserial gives in Postgres.
      // Append-only: LocalAdapter exposes no update or delete for this table.
      phase_events: '++id, video_id, [video_id+occurred_at], to_phase, occurred_at',
      bonus_tiers: 'id, campaign_id, &[campaign_id+threshold_views]',
      bonus_claims: 'id, video_id, &[video_id+bonus_tier_id]',
      time_estimates: 'id, &[user_id+setup], setup',
      user_settings: 'user_id',
      _outbox: '++id, queued_at, table_name',
    })

    // v2 adds phase_events.client_id - the key that makes pushing an event
    // idempotent. `&client_id` is the SQL's `unique (user_id, client_id)`;
    // there is only ever one user in a local store, so the user_id half of it
    // is implied.
    this.version(2)
      .stores({
        phase_events:
          '++id, &client_id, video_id, [video_id+occurred_at], to_phase, occurred_at',
      })
      .upgrade(async (tx) => {
        // Events written before this version have no key. They are minted one
        // each rather than left null, so that history recorded before the
        // upgrade can still be pushed exactly once.
        await tx
          .table('phase_events')
          .toCollection()
          .modify((event) => {
            if (!event.client_id) event.client_id = crypto.randomUUID()
          })
      })

    // v3 adds warmup_events - a new table, so no upgrade() migration of
    // existing data is needed, unlike phase_events.client_id above.
    this.version(3).stores({
      warmup_events: '++id, &client_id, campaign_id, [campaign_id+occurred_at], occurred_at',
    })

    // v4 replaces the campaign-level posting destination with editable
    // accounts. Existing local data is the source of truth, so this upgrade
    // derives only values the user already entered and leaves legacy fields in
    // place for review.
    this.version(4)
      .stores({
        campaigns: 'id, user_id, is_active, name',
        campaign_accounts: 'id, user_id, campaign_id, &[campaign_id+platform], [user_id+status], status',
        campaign_documents: 'id, campaign_id, kind',
        campaign_fields: 'id, campaign_id, &[campaign_id+field_key], source',
        campaign_angles: 'id, campaign_id, is_verified, sort_order',
        campaign_hooks: 'id, campaign_id, angle_id, [campaign_id+used_at], used_at',
        campaign_rules: 'id, campaign_id, sort_order',
        videos: 'id, campaign_id, phase, [campaign_id+phase], owed_for_date, kind',
        video_posts: 'id, video_id, &[video_id+platform], &[video_id+account_id], account_id',
        phase_events: '++id, &client_id, video_id, [video_id+occurred_at], to_phase, occurred_at, work_session_id',
        work_sessions: 'id, user_id, campaign_id, [campaign_id+started_at], [user_id+started_at], started_at',
        warmup_events: '++id, &client_id, campaign_id, account_id, [campaign_id+occurred_at], [account_id+occurred_at], occurred_at',
        bonus_tiers: 'id, campaign_id, &[campaign_id+threshold_views]',
        bonus_claims: 'id, video_id, &[video_id+bonus_tier_id]',
        time_estimates: 'id, &[user_id+setup], setup',
        user_settings: 'user_id',
        _outbox: '++id, queued_at, table_name',
      })
      // Wrapped so a failure cannot take the store with it. A throw inside a
      // Dexie upgrade aborts the version change and the database never opens
      // again on this device - his data would be intact and unreachable, which
      // is worse than starting with no derived accounts. Deriving them is a
      // convenience; the accounts editor can do the same job by hand.
      .upgrade(async (tx) => {
        try {
          await deriveAccountsAndTimestamps(tx)
        } catch (error) {
          console.error('v4 upgrade could not derive accounts; continuing.', error)
        }
      })
  }
}

async function deriveAccountsAndTimestamps(tx: Transaction): Promise<void> {
  const stamp = new Date().toISOString()

  // Six tables gained updated_at, and it is `not null` in the SQL and
  // required by the validators. Rows written before this version have
  // none, so without this backfill an export taken today would fail its
  // own import - the backup path breaking exactly when it is needed.
  for (const table of TIMESTAMPED_IN_V4) {
    await tx
      .table(table)
      .toCollection()
      .modify((row: { updated_at?: string }) => {
        if (!row.updated_at) row.updated_at = stamp
      })
  }

  // Accounts are derived only from values he entered himself: the
  // platforms he listed, the handles he typed, and the quota he set.
  // Nothing is invented - a platform with no handle gets a null handle
  // rather than a guessed one - and every row is editable on the brief
  // page, so a wrong derivation is a correction rather than a silent
  // wrong plan.
  const campaigns = await tx.table('campaigns').toArray()
  const fields = await tx.table('campaign_fields').toArray()
  const videos = await tx.table('videos').toArray()
  const warmups = await tx.table('warmup_events').toArray()
  const accounts = tx.table('campaign_accounts')

  for (const campaign of campaigns) {
    if (await accounts.where('campaign_id').equals(campaign.id).count()) continue

    const byKey = new Map<string, string | null>(
      fields
        .filter((field) => field.campaign_id === campaign.id)
        .map((field) => [field.field_key, field.field_value]),
    )

    // Warm-up status is carried forward rather than assumed. Marking
    // everything 'ready' would empty the warm-up screen and treat a
    // brand-new account as safe to post brand content from.
    const hasPosted =
      (campaign.opening_post_count ?? 0) > 0 ||
      videos.some((v) => v.campaign_id === campaign.id && v.phase === 'posted')
    const warmupCount = warmups.filter((w) => w.campaign_id === campaign.id).length
    const status = hasPosted || warmupCount >= 2 ? 'ready' : warmupCount === 1 ? 'warming' : 'new'

    const platforms = derivePlatforms(byKey)
    let sortOrder = 0
    for (const platform of platforms) {
      await accounts.add({
        id: crypto.randomUUID(),
        user_id: campaign.user_id,
        campaign_id: campaign.id,
        platform,
        handle: byKey.get(`handle_${normalisePlatform(platform)}`) ?? null,
        // His own number, copied per account - never divided or summed.
        posts_per_day: campaign.daily_post_quota ?? 0,
        status,
        is_active: true,
        sort_order: sortOrder++,
        created_at: stamp,
        updated_at: stamp,
      })
    }
  }
}

/** The tables that gained `updated_at` in v4. Existing rows carry none, and
 *  the column is `not null` in the SQL and required by the validators. */
const TIMESTAMPED_IN_V4 = [
  'campaign_angles',
  'campaign_rules',
  'video_posts',
  'bonus_tiers',
  'bonus_claims',
  'time_estimates',
] as const

/** `TikTok` -> `tiktok`, so a platform label finds its `handle_*` field however
 *  it was capitalised or spaced. */
function normalisePlatform(platform: string): string {
  return platform.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The platforms a campaign posts to, read off what he actually entered.
 *
 *  The `platforms` field is free text he or the parser wrote - "TikTok,
 *  Instagram", "TikTok + Instagram", "tiktok/instagram" have all to work - so
 *  it is split on every separator those use. A handle field implies its
 *  platform even when the list omits it. Deduped case-insensitively, because
 *  "tiktok" listed and "TikTok" implied are one account, not two. */
function derivePlatforms(byKey: ReadonlyMap<string, string | null>): string[] {
  const listed = String(byKey.get('platforms') ?? '')
    .split(/[,+/&]|\band\b/i)
    .map((item) => item.trim())
    .filter(Boolean)

  // A handle is proof of an account whatever the platforms field says.
  const implied = [...byKey.entries()]
    .filter(([key, value]) => key.startsWith('handle_') && value !== null && value.trim() !== '')
    .map(([key]) => key.slice('handle_'.length))

  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...listed, ...implied]) {
    const key = normalisePlatform(raw)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(KNOWN_PLATFORMS[key] ?? raw)
  }
  return out
}

/** Display spellings for the platforms that appear in his campaigns. Anything
 *  else is kept exactly as he typed it rather than being corrected. */
const KNOWN_PLATFORMS: Readonly<Record<string, string>> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

/** The tables that mirror schema.sql, in dependency order. `_outbox` is
 *  deliberately absent: it is a client concern and is never exported. */
export const MIRRORED_TABLES: readonly TableName[] = [
  'campaigns',
  'campaign_accounts',
  'campaign_documents',
  'campaign_fields',
  'campaign_angles',
  'campaign_hooks',
  'campaign_rules',
  'videos',
  'video_posts',
  'phase_events',
  'work_sessions',
  'warmup_events',
  'bonus_tiers',
  'bonus_claims',
  'time_estimates',
  'user_settings',
]
