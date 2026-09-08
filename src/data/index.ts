// The data layer's front door.
//
// Components import from here and nowhere deeper. Dexie lives behind
// ./local/db and is not re-exported: the rule that no component imports Dexie
// or supabase-js directly is enforced by there being nothing to import.
//
// When SupabaseAdapter lands in phase 9, `createAdapter` is the only function
// that changes.

export type {
  AdvanceOptions,
  BackupSnapshot,
  DataAdapter,
  ClaimResult,
  ImportResult,
  PendingWrite,
  ResetScope,
} from './DataAdapter'
export { MIRRORED_TABLES as MIRRORED_TABLE_NAMES } from './local/db'
export { ConstraintError } from './constraints'
export {
  DEFAULT_SETUP_SWITCH_MINUTES,
  DEFAULT_TIME_ESTIMATES,
  EXPORT_REMINDER_DAYS,
} from './defaults'
export { SESSION_TARGET_PHASE, chainFor, nextPhase, previousPhase } from './phases'
export {
  PLATFORMS_WITHOUT_WARMUP,
  WARMUP_MINUTES_BUILDING,
  WARMUP_MINUTES_MAINTENANCE,
  WARMUP_SESSIONS_REQUIRED,
  canPostFrom,
  lastWarmupAt,
  needsWarmup,
  warmsUp,
  warmupCompletions,
  warmupMinutesFor,
} from './warmup'
export { PULL_CURSOR_COLUMN } from './sync'
export * from './schema'

import type { DataAdapter } from './DataAdapter'
import { BACKUP_FORMAT_VERSION, DataError, LocalAdapter, localToday } from './local/LocalAdapter'

export { BACKUP_FORMAT_VERSION, DataError, localToday }

/** Supabase is not provisioned, so there is exactly one adapter to build. The
 *  signature is what phase 9 grows a branch inside; callers do not change. */
export function createAdapter(): DataAdapter {
  return new LocalAdapter()
}
