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
  bonus_tiers: 'updated_at',
  bonus_claims: 'updated_at',
  time_estimates: 'updated_at',
  user_settings: 'updated_at',
}
