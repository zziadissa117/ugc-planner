// What the sync layer talks to.
//
// The app never reads or writes through this. It reads and writes locally and
// returns immediately; the outbox is the record of what the server has not been
// told yet, and draining it is a background job. Nothing here is ever on the
// path of a tap.

import type { PendingWrite, TableName } from '../data'

export type PushOutcome =
  /** The server took it. */
  | { status: 'applied' }
  /** The server has a different version of this row. Carries it so the
   *  conflict can be resolved against something real. */
  | { status: 'conflict'; remote: Record<string, unknown> }
  /** The server will never take it - a constraint it breaks, a row it is not
   *  allowed to touch. Retrying cannot help, so the queue should stop trying. */
  | { status: 'rejected'; reason: string }
  /** Offline, timed out, server down. The write is still good; the network is
   *  not. Stays queued. */
  | { status: 'unavailable'; reason: string }

export interface RemoteChange {
  table: TableName
  row: Record<string, unknown>
}

export interface SyncTarget {
  readonly name: string
  /** False when there is nothing to sync to - no project, or signed out. */
  isReady(): boolean
  push(write: PendingWrite): Promise<PushOutcome>
  /** Rows changed on the server since `since`, oldest first. */
  pull(since: string | null): Promise<{ changes: RemoteChange[]; serverTime: string }>
}

export class SyncUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncUnavailableError'
  }
}
