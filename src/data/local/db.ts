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

import Dexie, { type EntityTable } from 'dexie'

import type {
  BonusClaim,
  BonusTier,
  Campaign,
  CampaignAngle,
  CampaignDocument,
  CampaignField,
  CampaignRule,
  PhaseEvent,
  TableName,
  TimeEstimate,
  UserSettings,
  Video,
  VideoPost,
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
  op: 'insert' | 'update'
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
  campaign_documents!: EntityTable<CampaignDocument, 'id'>
  campaign_fields!: EntityTable<CampaignField, 'id'>
  campaign_angles!: EntityTable<CampaignAngle, 'id'>
  campaign_rules!: EntityTable<CampaignRule, 'id'>
  videos!: EntityTable<Video, 'id'>
  video_posts!: EntityTable<VideoPost, 'id'>
  phase_events!: EntityTable<PhaseEvent, 'id'>
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
  }
}

/** The tables that mirror schema.sql, in dependency order. `_outbox` is
 *  deliberately absent: it is a client concern and is never exported. */
export const MIRRORED_TABLES: readonly TableName[] = [
  'campaigns',
  'campaign_documents',
  'campaign_fields',
  'campaign_angles',
  'campaign_rules',
  'videos',
  'video_posts',
  'phase_events',
  'bonus_tiers',
  'bonus_claims',
  'time_estimates',
  'user_settings',
]
