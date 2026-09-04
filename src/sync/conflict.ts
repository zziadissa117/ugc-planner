// What to do when the device and the server disagree about a row.
//
// He works on a PC, a MacBook and a phone, so two devices editing the same
// campaign between syncs is normal rather than exotic. The default is
// last-write-wins on updated_at, which is right for almost everything: the most
// recent statement about a campaign's name is the one he meant.
//
// It is wrong for exactly one thing, and that thing is the ledger.

import type { TableName } from '../data'

export type Winner = 'local' | 'remote'

export interface Resolution {
  winner: Winner
  /** The row to keep. Usually one side or the other; for videos it can be a
   *  merge, because one field there is not up for a vote. */
  row: Record<string, unknown>
  /** Plain-language note for the sync log. */
  reason: string
}

function timestampOf(row: Record<string, unknown>, key = 'updated_at'): number {
  const value = row[key]
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function resolveConflict(
  table: TableName,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): Resolution {
  // History is append-only and immutable. A phase_event that exists on both
  // sides is the same event told twice, and there is nothing to resolve - the
  // server's copy stands, and the local one is not re-pushed.
  if (table === 'phase_events') {
    return {
      winner: 'remote',
      row: remote,
      reason: 'history is append-only, so an existing event is never rewritten',
    }
  }

  if (table === 'videos') return resolveVideo(local, remote)

  const localNewer = timestampOf(local) > timestampOf(remote)
  return {
    winner: localNewer ? 'local' : 'remote',
    row: localNewer ? local : remote,
    reason: localNewer
      ? 'this device has the more recent edit'
      : 'the server has the more recent edit',
  }
}

/** Videos are last-write-wins like everything else, except for the rate
 *  snapshot, which is not an opinion about the row - it is the record of what
 *  a posted video earned.
 *
 *  Once either side has locked in a rate, that rate survives the merge whoever
 *  wins the rest of the row. Letting last-write-wins decide it would mean a
 *  stale device could null out earnings, or overwrite $35 with $50 because it
 *  synced later - and the whole point of the snapshot is that a rate change
 *  cannot rewrite what past work earned. */
function resolveVideo(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): Resolution {
  const localNewer = timestampOf(local) > timestampOf(remote)
  const winner: Winner = localNewer ? 'local' : 'remote'
  const base = localNewer ? local : remote

  const localRate = local.rate_snapshot_cents
  const remoteRate = remote.rate_snapshot_cents
  const localHas = typeof localRate === 'number'
  const remoteHas = typeof remoteRate === 'number'

  let row = { ...base }
  let reason = localNewer ? 'this device has the more recent edit' : 'the server has the more recent edit'

  if (localHas && remoteHas && localRate !== remoteRate) {
    // Both priced it, differently. The earlier snapshot is the one that
    // recorded what the work actually earned; the later one priced it again at
    // a rate that had already changed.
    const keepLocal = timestampOf(local, 'posted_at') <= timestampOf(remote, 'posted_at')
    row = { ...row, rate_snapshot_cents: keepLocal ? localRate : remoteRate }
    reason = 'kept the rate locked in when the video was first posted'
  } else if (localHas !== remoteHas) {
    // One side priced it and the other did not. A rate that exists beats a
    // blank: unpriced means unknown, and known beats unknown.
    row = { ...row, rate_snapshot_cents: localHas ? localRate : remoteRate }
    // posted_at travels with it, or the row breaks posted_is_timestamped.
    const source = localHas ? local : remote
    if (row.phase === 'posted' && row.posted_at == null) row.posted_at = source.posted_at
    reason = 'kept the rate one side had already locked in'
  }

  return { winner, row, reason }
}
