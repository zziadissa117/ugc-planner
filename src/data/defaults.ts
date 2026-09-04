// First-run defaults.
//
// These are app defaults the spec states outright, not campaign data. Nothing
// here describes a brand, a rate, a quota or a handle - those may only ever
// come from the user or from an uploaded document.

import type { SetupType } from './schema'

/** Starting per-setup times in minutes, from SPEC section 9. These are
 *  estimates and are labelled EST wherever they are shown. MEASURED values are
 *  derived from phase_events once there are two or more samples, and are never
 *  written back over these - an estimate must never be presentable as a
 *  measurement. All four rows are editable. */
export const DEFAULT_TIME_ESTIMATES: ReadonlyArray<{
  setup: SetupType
  film_minutes: number
  edit_minutes: number
  post_minutes: number
}> = [
  { setup: 'face', film_minutes: 12, edit_minutes: 15, post_minutes: 5 },
  { setup: 'screen', film_minutes: 8, edit_minutes: 12, post_minutes: 5 },
  { setup: 'phone', film_minutes: 10, edit_minutes: 12, post_minutes: 5 },
  { setup: 'notalk', film_minutes: 8, edit_minutes: 18, post_minutes: 5 },
]

/** Cost of changing setup mid-session, in minutes. SPEC section 9. Editable. */
export const DEFAULT_SETUP_SWITCH_MINUTES = 10

/** Prompt for an export once the last one is this old. SPEC section 13. */
export const EXPORT_REMINDER_DAYS = 7
