// Draining the outbox.
//
// Runs behind the user, never in front of them. Nothing in here is awaited by a
// tap: if it is slow, offline, or failing, the app carries on working exactly
// as it does now, because the app reads and writes locally and always has.

import type { DataAdapter, PendingWrite } from '../data'
import { resolveConflict } from './conflict'
import type { SyncTarget } from './types'

export interface DrainOptions {
  /** How many entries to attempt in one pass. */
  batchSize?: number
  /** After this many failed attempts an entry stops being retried on its own.
   *  It stays in the queue and stays visible - dropping a write because it is
   *  inconvenient is how data goes missing quietly. */
  maxAttempts?: number
}

export interface DrainReport {
  applied: number
  conflicts: number
  /** Permanently refused by the server. */
  rejected: number
  /** Left queued to try again. */
  deferred: number
  /** Stuck past maxAttempts, needing a person to look. */
  stuck: number
  notes: string[]
}

const DEFAULTS = { batchSize: 50, maxAttempts: 5 }

export async function drainOutbox(
  adapter: DataAdapter,
  target: SyncTarget,
  options: DrainOptions = {},
): Promise<DrainReport> {
  const { batchSize, maxAttempts } = { ...DEFAULTS, ...options }
  const report: DrainReport = {
    applied: 0,
    conflicts: 0,
    rejected: 0,
    deferred: 0,
    stuck: 0,
    notes: [],
  }

  if (!target.isReady()) {
    report.notes.push(`${target.name} is not ready, so nothing was sent.`)
    return report
  }

  const pending = await adapter.listPendingWrites(batchSize)

  for (const write of pending) {
    if (write.attempts >= maxAttempts) {
      // Left in the queue on purpose. It is still a write that happened.
      report.stuck++
      continue
    }

    const outcome = await pushOne(adapter, target, write, report)

    // The order writes happened in is the order they mean something in. Once
    // the network is gone, stop rather than firing the rest of the batch at it
    // and burning every entry's attempt count on the same outage.
    if (outcome === 'offline') {
      report.notes.push('Stopped: the server is not reachable.')
      break
    }
  }

  return report
}

async function pushOne(
  adapter: DataAdapter,
  target: SyncTarget,
  write: PendingWrite,
  report: DrainReport,
): Promise<'done' | 'offline'> {
  let outcome
  try {
    outcome = await target.push(write)
  } catch (error) {
    // A target that throws is treated as unavailable rather than as a bad
    // write: the write is not what failed.
    await adapter.markWriteFailed(write.id, describe(error))
    report.deferred++
    return 'offline'
  }

  switch (outcome.status) {
    case 'applied':
      await adapter.markWriteSynced(write.id)
      report.applied++
      return 'done'

    case 'conflict': {
      const local = write.payload as Record<string, unknown>
      const resolution = resolveConflict(write.table_name, local, outcome.remote)
      report.conflicts++
      report.notes.push(`${write.table_name} ${write.row_id}: ${resolution.reason}`)

      if (resolution.winner === 'remote') {
        // Take the server's version locally and stop trying to push ours.
        await adapter.applyRemoteRow(write.table_name, resolution.row)
        await adapter.markWriteSynced(write.id)
      } else {
        // Ours stands. Leave it queued so the next pass pushes the resolved
        // row; the server's version is now known to be older.
        await adapter.markWriteFailed(write.id, 'conflict resolved in favour of this device')
        report.deferred++
      }
      return 'done'
    }

    case 'rejected':
      // The server will never take this. Retrying is pointless, so it is
      // counted and left in the queue with the reason attached rather than
      // being thrown away.
      await adapter.markWriteFailed(write.id, `rejected: ${outcome.reason}`)
      report.rejected++
      report.notes.push(`${write.table_name} ${write.row_id} was refused: ${outcome.reason}`)
      return 'done'

    case 'unavailable':
      await adapter.markWriteFailed(write.id, outcome.reason)
      report.deferred++
      return 'offline'
  }
}

export interface PullReport {
  appliedRows: number
  serverTime: string | null
  notes: string[]
}

/** Brings down what changed on the server and writes it locally.
 *
 *  Pulled rows are applied without enqueuing: the server already has them, and
 *  echoing them back would be a loop that never settles. */
export async function pullChanges(
  adapter: DataAdapter,
  target: SyncTarget,
  since: string | null,
): Promise<PullReport> {
  if (!target.isReady()) {
    return { appliedRows: 0, serverTime: null, notes: [`${target.name} is not ready.`] }
  }

  const { changes, serverTime } = await target.pull(since)
  const notes: string[] = []
  let appliedRows = 0

  for (const change of changes) {
    try {
      await adapter.applyRemoteRow(change.table, change.row)
      appliedRows++
    } catch (error) {
      // A row the local store refuses is a row that would break a constraint
      // the schema states. Skipped and reported rather than forced in.
      notes.push(`Skipped a ${change.table} row from the server: ${describe(error)}`)
    }
  }

  return { appliedRows, serverTime, notes }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
