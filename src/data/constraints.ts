// Everything docs/schema.sql guarantees that IndexedDB will not.
//
// Postgres refuses a bad row. IndexedDB stores whatever you hand it: no types,
// no enum domains, no NOT NULL, no CHECK, no foreign keys. So every constraint
// in the SQL has to exist twice - once there, once here - or the local store
// and the eventual remote store will disagree about what a valid row is.
//
// `SQL_TABLE_CONSTRAINTS` and `SQL_COLUMN_CHECKS` in schema.ts are generated
// straight from the SQL and are the checklist this file has to satisfy. When a
// constraint is added to schema.sql, it appears there, and the matching guard
// belongs here.
//
// Uniqueness and foreign keys are not here: those need to look at other rows,
// so Dexie's unique indexes handle the former and LocalAdapter handles the
// latter inside a transaction.

import {
  APPROVAL_MODE_VALUES,
  DOCUMENT_KIND_VALUES,
  FIELD_SOURCE_VALUES,
  SESSION_TYPE_VALUES,
  SETUP_TYPE_VALUES,
  VIDEO_KIND_VALUES,
  VIDEO_PHASE_VALUES,
  type BonusClaim,
  type BonusTier,
  type Campaign,
  type CampaignAccount,
  type CampaignAngle,
  type CampaignHook,
  type CampaignDocument,
  type CampaignField,
  type CampaignRule,
  type PhaseEvent,
  type TableName,
  type TimeEstimate,
  type UserSettings,
  type Video,
  type VideoPost,
  type WarmupEvent,
  type WorkSession,
} from './schema'

/** A row that Postgres would have rejected. Carries the constraint name from
 *  the SQL where there is one, so a failure here and a failure after sync
 *  reads the same. */
export class ConstraintError extends Error {
  readonly table: TableName
  readonly constraint: string

  constructor(table: TableName, constraint: string, message: string) {
    super(`${table}: ${message}`)
    this.name = 'ConstraintError'
    this.table = table
    this.constraint = constraint
  }
}

// --- Primitive guards ------------------------------------------------------

function fail(table: TableName, constraint: string, message: string): never {
  throw new ConstraintError(table, constraint, message)
}

function isEnum<T extends string>(
  table: TableName,
  column: string,
  value: unknown,
  allowed: readonly T[],
  nullable: boolean,
): void {
  if (value === null || value === undefined) {
    if (!nullable) fail(table, `${column}_not_null`, `${column} must not be null`)
    return
  }
  if (!allowed.includes(value as T)) {
    fail(
      table,
      `${column}_enum`,
      `${column} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`,
    )
  }
}

/** Integer columns. Money is integer cents everywhere, so a float reaching one
 *  of these is a bug worth stopping on rather than rounding away. */
function integer(
  table: TableName,
  column: string,
  value: unknown,
  { min, exclusiveMin, nullable }: { min?: number; exclusiveMin?: number; nullable: boolean },
): void {
  if (value === null || value === undefined) {
    if (!nullable) fail(table, `${column}_not_null`, `${column} must not be null`)
    return
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(table, `${column}_integer`, `${column} must be an integer, got ${JSON.stringify(value)}`)
  }
  if (min !== undefined && value < min) {
    fail(table, `${column}_check`, `${column} must be >= ${min}, got ${value}`)
  }
  if (exclusiveMin !== undefined && value <= exclusiveMin) {
    fail(table, `${column}_check`, `${column} must be > ${exclusiveMin}, got ${value}`)
  }
}

function text(
  table: TableName,
  column: string,
  value: unknown,
  { nullable }: { nullable: boolean },
): void {
  if (value === null || value === undefined) {
    if (!nullable) fail(table, `${column}_not_null`, `${column} must not be null`)
    return
  }
  if (typeof value !== 'string') {
    fail(table, `${column}_type`, `${column} must be text, got ${typeof value}`)
  }
}

function boolean(table: TableName, column: string, value: unknown): void {
  if (typeof value !== 'boolean') {
    fail(table, `${column}_type`, `${column} must be a boolean, got ${typeof value}`)
  }
}

/** timestamptz. Stored as an ISO 8601 string so it sorts lexicographically and
 *  survives a JSON round trip unchanged. */
function timestamp(
  table: TableName,
  column: string,
  value: unknown,
  { nullable }: { nullable: boolean },
): void {
  if (value === null || value === undefined) {
    if (!nullable) fail(table, `${column}_not_null`, `${column} must not be null`)
    return
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(table, `${column}_type`, `${column} must be an ISO timestamp, got ${JSON.stringify(value)}`)
  }
}

/** date. Calendar day, no time and no zone: the posting quota resets at the
 *  user's midnight, not UTC's. */
function dateOnly(
  table: TableName,
  column: string,
  value: unknown,
  { nullable }: { nullable: boolean },
): void {
  if (value === null || value === undefined) {
    if (!nullable) fail(table, `${column}_not_null`, `${column} must not be null`)
    return
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(table, `${column}_type`, `${column} must be YYYY-MM-DD, got ${JSON.stringify(value)}`)
  }
}

// --- Per-table validators --------------------------------------------------

export function assertCampaign(row: Campaign): void {
  const t: TableName = 'campaigns'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'name', row.name, { nullable: false })
  text(t, 'company', row.company, { nullable: true })
  boolean(t, 'is_active', row.is_active)
  isEnum(t, 'approval_mode', row.approval_mode, APPROVAL_MODE_VALUES, false)
  isEnum(t, 'default_setup', row.default_setup, SETUP_TYPE_VALUES, true)
  integer(t, 'daily_post_quota', row.daily_post_quota, { min: 0, nullable: false })
  integer(t, 'pay_per_video_cents', row.pay_per_video_cents, { min: 0, nullable: true })
  integer(t, 'cycle_size', row.cycle_size, { exclusiveMin: 0, nullable: true })
  integer(t, 'monthly_pay_override_cents', row.monthly_pay_override_cents, {
    min: 0,
    nullable: true,
  })
  boolean(t, 'pays_per_platform', row.pays_per_platform)
  integer(t, 'opening_post_count', row.opening_post_count, { min: 0, nullable: false })
  boolean(t, 'brief_is_incomplete', row.brief_is_incomplete)
  timestamp(t, 'created_at', row.created_at, { nullable: false })
  timestamp(t, 'updated_at', row.updated_at, { nullable: false })
}

export function assertCampaignDocument(row: CampaignDocument): void {
  const t: TableName = 'campaign_documents'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  isEnum(t, 'kind', row.kind, DOCUMENT_KIND_VALUES, false)
  text(t, 'filename', row.filename, { nullable: true })
  // The raw upload is kept forever, so the brief page can render the real
  // document rather than a summary of it.
  text(t, 'raw_text', row.raw_text, { nullable: false })
  timestamp(t, 'uploaded_at', row.uploaded_at, { nullable: false })
}

export function assertCampaignField(row: CampaignField): void {
  const t: TableName = 'campaign_fields'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  text(t, 'field_key', row.field_key, { nullable: false })
  text(t, 'field_value', row.field_value, { nullable: true })
  isEnum(t, 'source', row.source, FIELD_SOURCE_VALUES, false)
  text(t, 'source_quote', row.source_quote, { nullable: true })
  text(t, 'source_document_id', row.source_document_id, { nullable: true })
  timestamp(t, 'confirmed_at', row.confirmed_at, { nullable: true })
  timestamp(t, 'updated_at', row.updated_at, { nullable: false })

  // constraint parsed_is_unconfirmed
  if (row.source === 'parsed_unreviewed' && row.confirmed_at !== null) {
    fail(
      t,
      'parsed_is_unconfirmed',
      'a parsed field is by definition unconfirmed, so it cannot carry confirmed_at',
    )
  }
  // constraint documented_needs_proof
  if (row.source === 'documented' && (row.confirmed_at === null || row.source_quote === null)) {
    fail(
      t,
      'documented_needs_proof',
      'a documented field must be confirmed and must quote the document it came from',
    )
  }
  // constraint missing_is_empty
  if (row.source === 'missing' && row.field_value !== null) {
    fail(t, 'missing_is_empty', 'a missing field holds no value - it renders "not saved yet"')
  }
}

export function assertCampaignAngle(row: CampaignAngle): void {
  const t: TableName = 'campaign_angles'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  text(t, 'label', row.label, { nullable: false })
  text(t, 'body', row.body, { nullable: true })
  text(t, 'family', row.family, { nullable: true })
  // Unverified angles came from somewhere other than the campaign's own
  // documents and must be displayed separately, never merged into the
  // documented list.
  boolean(t, 'is_verified', row.is_verified)
  integer(t, 'sort_order', row.sort_order, { nullable: false })
}

export function assertCampaignAccount(row: CampaignAccount): void {
  const t: TableName = 'campaign_accounts'
  text(t, 'id', row.id, { nullable: false }); text(t, 'user_id', row.user_id, { nullable: false }); text(t, 'campaign_id', row.campaign_id, { nullable: false }); text(t, 'platform', row.platform, { nullable: false }); text(t, 'handle', row.handle, { nullable: true }); text(t, 'email', row.email, { nullable: true }); text(t, 'password', row.password, { nullable: true })
  integer(t, 'posts_per_day', row.posts_per_day, { min: 0, nullable: false }); isEnum(t, 'status', row.status, ['new', 'warming', 'ready'], false); boolean(t, 'is_active', row.is_active); integer(t, 'sort_order', row.sort_order, { nullable: false }); timestamp(t, 'created_at', row.created_at, { nullable: false }); timestamp(t, 'updated_at', row.updated_at, { nullable: false })
}

export function assertCampaignHook(row: CampaignHook): void {
  const t: TableName = 'campaign_hooks'
  text(t, 'id', row.id, { nullable: false }); text(t, 'user_id', row.user_id, { nullable: false }); text(t, 'campaign_id', row.campaign_id, { nullable: false }); text(t, 'angle_id', row.angle_id, { nullable: true }); text(t, 'body', row.body, { nullable: false }); text(t, 'outline', row.outline, { nullable: true }); isEnum(t, 'source', row.source, ['generated', 'user_entered'], false); text(t, 'model', row.model, { nullable: true }); timestamp(t, 'generated_at', row.generated_at, { nullable: true }); timestamp(t, 'used_at', row.used_at, { nullable: true }); timestamp(t, 'created_at', row.created_at, { nullable: false }); timestamp(t, 'updated_at', row.updated_at, { nullable: false })
  if (row.source === 'generated' && (row.model === null || row.generated_at === null)) fail(t, 'generated_names_its_model', 'a generated hook needs a model and time')
  if (row.source === 'user_entered' && (row.model !== null || row.generated_at !== null)) fail(t, 'user_entered_has_no_model', 'a user-entered hook cannot name a model')
}

export function assertCampaignRule(row: CampaignRule): void {
  const t: TableName = 'campaign_rules'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  text(t, 'body', row.body, { nullable: false })
  boolean(t, 'is_verified', row.is_verified)
  integer(t, 'sort_order', row.sort_order, { nullable: false })
}

export function assertVideo(row: Video): void {
  const t: TableName = 'videos'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  isEnum(t, 'kind', row.kind, VIDEO_KIND_VALUES, false)
  isEnum(t, 'setup', row.setup, SETUP_TYPE_VALUES, true)
  text(t, 'angle_id', row.angle_id, { nullable: true })
  isEnum(t, 'phase', row.phase, VIDEO_PHASE_VALUES, false)
  text(t, 'script', row.script, { nullable: true })
  text(t, 'blocked_reason', row.blocked_reason, { nullable: true })
  dateOnly(t, 'owed_for_date', row.owed_for_date, { nullable: true })
  integer(t, 'rate_snapshot_cents', row.rate_snapshot_cents, { min: 0, nullable: true })
  timestamp(t, 'posted_at', row.posted_at, { nullable: true })
  timestamp(t, 'created_at', row.created_at, { nullable: false })
  timestamp(t, 'updated_at', row.updated_at, { nullable: false })

  // constraint posted_is_timestamped. A posted video must say when it went
  // live. It need not carry a rate: rate_snapshot_cents null means UNPRICED,
  // not free. An unconfirmed rate must not block the posting tap, and a 0 in
  // the ledger would be a fabricated "earned nothing".
  //
  // What still makes the ledger non-rewritable is that a snapshot, once
  // written, is never touched by a later rate change.
  if (row.phase === 'posted' && row.posted_at === null) {
    fail(t, 'posted_is_timestamped', 'a posted video must say when it went live')
  }
}

export function assertVideoPost(row: VideoPost): void {
  const t: TableName = 'video_posts'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'video_id', row.video_id, { nullable: false })
  text(t, 'account_id', row.account_id, { nullable: true })
  text(t, 'platform', row.platform, { nullable: false })
  text(t, 'url', row.url, { nullable: true })
  timestamp(t, 'posted_at', row.posted_at, { nullable: false })
  integer(t, 'view_count', row.view_count, { min: 0, nullable: true })
  timestamp(t, 'view_count_entered_at', row.view_count_entered_at, { nullable: true })
  timestamp(t, 'updated_at', row.updated_at, { nullable: false })
}

export function assertPhaseEvent(row: PhaseEvent): void {
  const t: TableName = 'phase_events'
  integer(t, 'id', row.id, { min: 1, nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'video_id', row.video_id, { nullable: false })
  isEnum(t, 'from_phase', row.from_phase, VIDEO_PHASE_VALUES, true)
  isEnum(t, 'to_phase', row.to_phase, VIDEO_PHASE_VALUES, false)
  isEnum(t, 'session', row.session, SESSION_TYPE_VALUES, true)
  text(t, 'work_session_id', row.work_session_id, { nullable: true })
  timestamp(t, 'occurred_at', row.occurred_at, { nullable: false })
  integer(t, 'duration_seconds', row.duration_seconds, { min: 0, nullable: true })
}

export function assertWarmupEvent(row: WarmupEvent): void {
  const t: TableName = 'warmup_events'
  integer(t, 'id', row.id, { min: 1, nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  text(t, 'account_id', row.account_id, { nullable: true })
  integer(t, 'minutes', row.minutes, { exclusiveMin: 0, nullable: false })
  timestamp(t, 'occurred_at', row.occurred_at, { nullable: false })
  text(t, 'client_id', row.client_id, { nullable: false })
}

export function assertWorkSession(row: WorkSession): void {
  const t: TableName = 'work_sessions'
  text(t, 'id', row.id, { nullable: false }); text(t, 'user_id', row.user_id, { nullable: false }); text(t, 'campaign_id', row.campaign_id, { nullable: false }); isEnum(t, 'kind', row.kind, SESSION_TYPE_VALUES, false); integer(t, 'goal_videos', row.goal_videos, { exclusiveMin: 0, nullable: false }); integer(t, 'planned_minutes', row.planned_minutes, { exclusiveMin: 0, nullable: false }); timestamp(t, 'started_at', row.started_at, { nullable: false }); timestamp(t, 'ended_at', row.ended_at, { nullable: true }); timestamp(t, 'created_at', row.created_at, { nullable: false }); timestamp(t, 'updated_at', row.updated_at, { nullable: false })
  if (row.ended_at !== null && Date.parse(row.ended_at) < Date.parse(row.started_at)) fail(t, 'ends_after_it_starts', 'ended_at must not be before started_at')
}

export function assertBonusTier(row: BonusTier): void {
  const t: TableName = 'bonus_tiers'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'campaign_id', row.campaign_id, { nullable: false })
  text(t, 'label', row.label, { nullable: false })
  integer(t, 'threshold_views', row.threshold_views, { exclusiveMin: 0, nullable: false })
  integer(t, 'payout_cents', row.payout_cents, { min: 0, nullable: false })
  integer(t, 'view_window_days', row.view_window_days, { nullable: true })
}

export function assertBonusClaim(row: BonusClaim): void {
  const t: TableName = 'bonus_claims'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  text(t, 'video_id', row.video_id, { nullable: false })
  text(t, 'bonus_tier_id', row.bonus_tier_id, { nullable: false })

  // EXPECTED bonus is payout times a probability the user typed. numeric(3,2),
  // 0..1. It defaults to zero so the expected column reads $0 until he judges
  // it - never a guessed likelihood.
  if (typeof row.probability !== 'number' || Number.isNaN(row.probability)) {
    fail(t, 'probability_type', 'probability must be a number')
  }
  if (row.probability < 0 || row.probability > 1) {
    fail(t, 'probability_check', `probability must be between 0 and 1, got ${row.probability}`)
  }
  if (Math.round(row.probability * 100) !== row.probability * 100) {
    fail(t, 'probability_scale', 'probability is numeric(3,2) - at most two decimal places')
  }

  integer(t, 'received_cents', row.received_cents, { min: 0, nullable: true })
  timestamp(t, 'received_at', row.received_at, { nullable: true })

  // constraint received_needs_date
  if (row.received_cents !== null && row.received_at === null) {
    fail(t, 'received_needs_date', 'money logged as received must say when it was received')
  }
}

export function assertTimeEstimate(row: TimeEstimate): void {
  const t: TableName = 'time_estimates'
  text(t, 'id', row.id, { nullable: false })
  text(t, 'user_id', row.user_id, { nullable: false })
  isEnum(t, 'setup', row.setup, SETUP_TYPE_VALUES, false)
  integer(t, 'film_minutes', row.film_minutes, { exclusiveMin: 0, nullable: false })
  integer(t, 'edit_minutes', row.edit_minutes, { exclusiveMin: 0, nullable: false })
  integer(t, 'post_minutes', row.post_minutes, { exclusiveMin: 0, nullable: false })
}

export function assertUserSettings(row: UserSettings): void {
  const t: TableName = 'user_settings'
  text(t, 'user_id', row.user_id, { nullable: false })
  integer(t, 'setup_switch_minutes', row.setup_switch_minutes, { min: 0, nullable: false })
  // Ships null on purpose. The runway figure depends on it, and a seeded guess
  // would be indistinguishable from a real count.
  integer(t, 'opening_unedited_count', row.opening_unedited_count, { min: 0, nullable: true })
  timestamp(t, 'last_export_at', row.last_export_at, { nullable: true })
  timestamp(t, 'updated_at', row.updated_at, { nullable: false })
}

/** Dispatch by table name. Used by the importer, which is handed arbitrary
 *  JSON and must not trust a single field of it. */
const VALIDATORS = {
  campaigns: assertCampaign,
  campaign_accounts: assertCampaignAccount,
  campaign_documents: assertCampaignDocument,
  campaign_fields: assertCampaignField,
  campaign_angles: assertCampaignAngle,
  campaign_hooks: assertCampaignHook,
  campaign_rules: assertCampaignRule,
  videos: assertVideo,
  video_posts: assertVideoPost,
  phase_events: assertPhaseEvent,
  work_sessions: assertWorkSession,
  warmup_events: assertWarmupEvent,
  bonus_tiers: assertBonusTier,
  bonus_claims: assertBonusClaim,
  time_estimates: assertTimeEstimate,
  user_settings: assertUserSettings,
} satisfies { [K in TableName]: (row: never) => void }

export function assertRow<K extends TableName>(
  table: K,
  row: Parameters<(typeof VALIDATORS)[K]>[0],
): void {
  ;(VALIDATORS[table] as (r: unknown) => void)(row)
}
