// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced from docs/schema.sql by scripts/generate-types.mjs.
// Change the SQL, then run `npm run generate:types`.
//
// docs/schema.sql is the authoritative shape: the local store mirrors
// Postgres table for table and column for column, so that the eventual
// SupabaseAdapter needs no translation layer.

// --- Enums ---------------------------------------------------------------

export type SetupType =
  | 'face'
  | 'screen'
  | 'phone'
  | 'notalk'

export const SETUP_TYPE_VALUES = [
  'face',
  'screen',
  'phone',
  'notalk',
] as const satisfies readonly SetupType[]

export type SessionType =
  | 'film'
  | 'edit'
  | 'post'
  | 'warm_up'

export const SESSION_TYPE_VALUES = [
  'film',
  'edit',
  'post',
  'warm_up',
] as const satisfies readonly SessionType[]

export type VideoPhase =
  | 'awaiting_brief'
  | 'awaiting_script_approval'
  | 'to_film'
  | 'filmed'
  | 'edited'
  | 'submitted'
  | 'approved'
  | 'posted'

export const VIDEO_PHASE_VALUES = [
  'awaiting_brief',
  'awaiting_script_approval',
  'to_film',
  'filmed',
  'edited',
  'submitted',
  'approved',
  'posted',
] as const satisfies readonly VideoPhase[]

export type ApprovalMode =
  | 'none'
  | 'video'
  | 'script_and_video'
  | 'brand_scripted'

export const APPROVAL_MODE_VALUES = [
  'none',
  'video',
  'script_and_video',
  'brand_scripted',
] as const satisfies readonly ApprovalMode[]

export type VideoKind =
  | 'contracted'
  | 'warm_up'
  | 'wider_topic'
  | 'no_quota'

export const VIDEO_KIND_VALUES = [
  'contracted',
  'warm_up',
  'wider_topic',
  'no_quota',
] as const satisfies readonly VideoKind[]

export type FieldSource =
  | 'documented'
  | 'parsed_unreviewed'
  | 'user_entered'
  | 'missing'

export const FIELD_SOURCE_VALUES = [
  'documented',
  'parsed_unreviewed',
  'user_entered',
  'missing',
] as const satisfies readonly FieldSource[]

export type DocumentKind =
  | 'brief'
  | 'contract'
  | 'other'

export const DOCUMENT_KIND_VALUES = [
  'brief',
  'contract',
  'other',
] as const satisfies readonly DocumentKind[]

// --- Row types -----------------------------------------------------------

/** Mirrors `campaigns`. */
export interface Campaign {
  id: string
  user_id: string
  name: string
  company: string | null
  is_active: boolean
  approval_mode: ApprovalMode
  default_setup: SetupType | null
  daily_post_quota: number
  pay_per_video_cents: number | null
  cycle_size: number | null
  opening_post_count: number
  brief_is_incomplete: boolean
  created_at: string
  updated_at: string
}

/** `campaigns` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewCampaign = Omit<Campaign, 'user_id' | 'id' | 'is_active' | 'approval_mode' | 'daily_post_quota' | 'opening_post_count' | 'brief_is_incomplete' | 'created_at' | 'updated_at'> &
  Partial<Pick<Campaign, 'id' | 'is_active' | 'approval_mode' | 'daily_post_quota' | 'opening_post_count' | 'brief_is_incomplete' | 'created_at' | 'updated_at'>>

/** Mirrors `campaign_documents`. */
export interface CampaignDocument {
  id: string
  user_id: string
  campaign_id: string
  kind: DocumentKind
  filename: string | null
  raw_text: string
  uploaded_at: string
}

/** `campaign_documents` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewCampaignDocument = Omit<CampaignDocument, 'user_id' | 'id' | 'uploaded_at'> &
  Partial<Pick<CampaignDocument, 'id' | 'uploaded_at'>>

/** Mirrors `campaign_fields`. */
export interface CampaignField {
  id: string
  user_id: string
  campaign_id: string
  field_key: string
  field_value: string | null
  source: FieldSource
  source_quote: string | null
  source_document_id: string | null
  confirmed_at: string | null
  updated_at: string
}

/** `campaign_fields` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewCampaignField = Omit<CampaignField, 'user_id' | 'id' | 'updated_at'> &
  Partial<Pick<CampaignField, 'id' | 'updated_at'>>

/** Mirrors `campaign_angles`. */
export interface CampaignAngle {
  id: string
  user_id: string
  campaign_id: string
  label: string
  body: string | null
  family: string | null
  is_verified: boolean
  sort_order: number
}

/** `campaign_angles` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewCampaignAngle = Omit<CampaignAngle, 'user_id' | 'id' | 'is_verified' | 'sort_order'> &
  Partial<Pick<CampaignAngle, 'id' | 'is_verified' | 'sort_order'>>

/** Mirrors `campaign_rules`. */
export interface CampaignRule {
  id: string
  user_id: string
  campaign_id: string
  body: string
  is_verified: boolean
  sort_order: number
}

/** `campaign_rules` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewCampaignRule = Omit<CampaignRule, 'user_id' | 'id' | 'is_verified' | 'sort_order'> &
  Partial<Pick<CampaignRule, 'id' | 'is_verified' | 'sort_order'>>

/** Mirrors `videos`. */
export interface Video {
  id: string
  user_id: string
  campaign_id: string
  kind: VideoKind
  setup: SetupType | null
  angle_id: string | null
  phase: VideoPhase
  script: string | null
  blocked_reason: string | null
  owed_for_date: string | null
  rate_snapshot_cents: number | null
  posted_at: string | null
  created_at: string
  updated_at: string
}

/** `videos` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewVideo = Omit<Video, 'user_id' | 'id' | 'kind' | 'phase' | 'created_at' | 'updated_at'> &
  Partial<Pick<Video, 'id' | 'kind' | 'phase' | 'created_at' | 'updated_at'>>

/** Mirrors `video_posts`. */
export interface VideoPost {
  id: string
  user_id: string
  video_id: string
  platform: string
  url: string | null
  posted_at: string
  view_count: number | null
  view_count_entered_at: string | null
}

/** `video_posts` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewVideoPost = Omit<VideoPost, 'user_id' | 'id' | 'posted_at'> &
  Partial<Pick<VideoPost, 'id' | 'posted_at'>>

/** Mirrors `phase_events`. */
export interface PhaseEvent {
  id: number
  user_id: string
  video_id: string
  from_phase: VideoPhase | null
  to_phase: VideoPhase
  session: SessionType | null
  occurred_at: string
  duration_seconds: number | null
}

/** `phase_events` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewPhaseEvent = Omit<PhaseEvent, 'user_id' | 'id' | 'occurred_at'> &
  Partial<Pick<PhaseEvent, 'id' | 'occurred_at'>>

/** Mirrors `bonus_tiers`. */
export interface BonusTier {
  id: string
  user_id: string
  campaign_id: string
  label: string
  threshold_views: number
  payout_cents: number
  view_window_days: number | null
}

/** `bonus_tiers` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewBonusTier = Omit<BonusTier, 'user_id' | 'id'> &
  Partial<Pick<BonusTier, 'id'>>

/** Mirrors `bonus_claims`. */
export interface BonusClaim {
  id: string
  user_id: string
  video_id: string
  bonus_tier_id: string
  probability: number
  received_cents: number | null
  received_at: string | null
}

/** `bonus_claims` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewBonusClaim = Omit<BonusClaim, 'user_id' | 'id' | 'probability'> &
  Partial<Pick<BonusClaim, 'id' | 'probability'>>

/** Mirrors `time_estimates`. */
export interface TimeEstimate {
  id: string
  user_id: string
  setup: SetupType
  film_minutes: number
  edit_minutes: number
  post_minutes: number
}

/** `time_estimates` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewTimeEstimate = Omit<TimeEstimate, 'user_id' | 'id'> &
  Partial<Pick<TimeEstimate, 'id'>>

/** Mirrors `user_settings`. */
export interface UserSettings {
  user_id: string
  setup_switch_minutes: number
  opening_unedited_count: number | null
  last_export_at: string | null
  updated_at: string
}

/** `user_settings` as supplied by a caller: user_id comes from the session, and
 *  columns the database defaults are optional. */
export type NewUserSettings = Omit<UserSettings, 'user_id' | 'setup_switch_minutes' | 'updated_at'> &
  Partial<Pick<UserSettings, 'setup_switch_minutes' | 'updated_at'>>

// --- Table registry ------------------------------------------------------

/** Every table, in dependency order: parents before children, so an import
 *  can replay them top to bottom without dangling references. */
export const TABLE_NAMES = [
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
] as const

export type TableName = (typeof TABLE_NAMES)[number]

/** Maps each table name to its row type. */
export interface TableRowMap {
  campaigns: Campaign
  campaign_documents: CampaignDocument
  campaign_fields: CampaignField
  campaign_angles: CampaignAngle
  campaign_rules: CampaignRule
  videos: Video
  video_posts: VideoPost
  phase_events: PhaseEvent
  bonus_tiers: BonusTier
  bonus_claims: BonusClaim
  time_estimates: TimeEstimate
  user_settings: UserSettings
}

// --- Constraints carried over from the SQL --------------------------------

/** The table-level constraints IndexedDB cannot enforce, kept here verbatim
 *  so that src/data/constraints.ts can be checked against them by eye.
 *  The enforcing code lives there; this is the record of what it owes. */
export const SQL_TABLE_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = {
  campaign_fields: [
    "unique (campaign_id, field_key)",
    "constraint parsed_is_unconfirmed check (source <> 'parsed_unreviewed' or confirmed_at is null)",
    "constraint documented_needs_proof check (source <> 'documented' or (confirmed_at is not null and source_quote is not null))",
    "constraint missing_is_empty check (source <> 'missing' or field_value is null)",
  ],
  videos: [
    "constraint posted_is_timestamped check (phase <> 'posted' or posted_at is not null)",
  ],
  video_posts: [
    "unique (video_id, platform)",
  ],
  bonus_tiers: [
    "unique (campaign_id, threshold_views)",
  ],
  bonus_claims: [
    "unique (video_id, bonus_tier_id)",
    "constraint received_needs_date check (received_cents is null or received_at is not null)",
  ],
  time_estimates: [
    "unique (user_id, setup)",
  ],
}

/** Column-level CHECKs, per table, per column. Mostly the non-negative
 *  guards on money and counts - IndexedDB enforces none of them. */
export const SQL_COLUMN_CHECKS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  campaigns: {
    daily_post_quota: ["check (daily_post_quota >= 0)"],
    pay_per_video_cents: ["check (pay_per_video_cents >= 0)"],
    cycle_size: ["check (cycle_size > 0)"],
    opening_post_count: ["check (opening_post_count >= 0)"],
  },
  videos: {
    rate_snapshot_cents: ["check (rate_snapshot_cents >= 0)"],
  },
  video_posts: {
    view_count: ["check (view_count >= 0)"],
  },
  phase_events: {
    duration_seconds: ["check (duration_seconds >= 0)"],
  },
  bonus_tiers: {
    threshold_views: ["check (threshold_views > 0)"],
    payout_cents: ["check (payout_cents >= 0)"],
  },
  bonus_claims: {
    probability: ["check (probability >= 0 and probability <= 1)"],
    received_cents: ["check (received_cents >= 0)"],
  },
  time_estimates: {
    film_minutes: ["check (film_minutes > 0)"],
    edit_minutes: ["check (edit_minutes > 0)"],
    post_minutes: ["check (post_minutes > 0)"],
  },
  user_settings: {
    setup_switch_minutes: ["check (setup_switch_minutes >= 0)"],
    opening_unedited_count: ["check (opening_unedited_count >= 0)"],
  },
}
