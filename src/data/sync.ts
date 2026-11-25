// The cursor for every mirrored table. Keeping this beside the table registry
// makes adding a table a compile-time review item instead of a fragile ternary
// hidden in the transport.
import type { TableName } from './schema'

export const PULL_CURSOR_COLUMN: Readonly<Record<TableName, string>> = {
  campaigns: 'updated_at',
  campaign_accounts: 'updated_at',
  campaign_documents: 'uploaded_at',
  campaign_fields: 'updated_at',
  campaign_angles: 'updated_at',
  campaign_hooks: 'updated_at',
  campaign_rules: 'updated_at',
  videos: 'updated_at',
  video_posts: 'updated_at',
  phase_events: 'occurred_at',
  work_sessions: 'updated_at',
  warmup_events: 'occurred_at',
  earnings_events: 'occurred_at',
  campaign_payouts: 'updated_at',
  side_income: 'updated_at',
  plan_blocks: 'updated_at',
  // Never updated, so updated_at is the moment it was written - which is what
  // a pull needs, where made_at can be backdated.
  trybe_videos: 'updated_at',
  ideate_notes: 'updated_at',
  // Pull-only: the coach function writes it and must bump updated_at on every
  // edit, or the edit never reaches the student.
  coach_notes: 'updated_at',
  bonus_tiers: 'updated_at',
  bonus_claims: 'updated_at',
  time_estimates: 'updated_at',
  user_settings: 'updated_at',
}

/** Tables with a second unique key besides `id`, where two devices can each
 *  mint their own id for what the server holds as one row - a campaign's pay,
 *  typed on the phone while the laptop's copy had not come down yet. The
 *  server refuses the second with 23505 and, until the device takes the
 *  server's id, refuses every later save of it too (288 of them on one
 *  device), while the pull skips the server's copy because the key is taken.
 *
 *  Only tables no other row points at belong here: taking the server's id is
 *  then a rename and nothing else. campaign_accounts and bonus_tiers have keys
 *  like this too, but video_posts and bonus_claims point at them by id. */
export const NATURAL_KEYS: Partial<Readonly<Record<TableName, readonly string[]>>> = {
  campaign_fields: ['campaign_id', 'field_key'],
}
