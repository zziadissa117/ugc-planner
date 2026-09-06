// The sync target over Supabase.
//
// Verified end to end against the real project: src/sync/rls.live.test.ts and
// src/sync/claim.live.test.ts drive this class over real HTTP - real accounts,
// real RLS, a real drain - not just a recording double that proves the calls
// it makes. See docs/SYNC.md.

import type { SupabaseClient } from '@supabase/supabase-js'

import { MIRRORED_TABLE_NAMES, PULL_CURSOR_COLUMN, type PendingWrite, type TableName } from '../data'
import type { PushOutcome, RemoteChange, SyncTarget } from './types'

/** Postgres error codes worth telling apart.
 *
 *  The distinction that matters is permanent versus transient: a broken
 *  constraint will break again on every retry, and a dropped connection will
 *  not. Retrying the first forever burns the queue; giving up on the second
 *  loses the write. */
const PERMANENT_CODES = new Set([
  '23502', // not null violation
  '23503', // foreign key violation
  '23514', // check violation
  '23505', // unique violation - the row is already there
  '42501', // RLS refused it
  '22P02', // bad input syntax
])

export class SupabaseSyncTarget implements SyncTarget {
  readonly name = 'Supabase'

  private readonly client: SupabaseClient | null

  constructor(client: SupabaseClient | null) {
    this.client = client
  }

  isReady(): boolean {
    return this.client !== null
  }

  async push(write: PendingWrite): Promise<PushOutcome> {
    if (!this.client) return { status: 'unavailable', reason: 'No Supabase client configured.' }

    const row = write.payload as Record<string, unknown>

    // A delete names a row; there is nothing to upsert. Already gone counts as
    // applied - the point of the push was that the server not have it.
    if (write.op === 'delete') {
      const { error } = await this.client.from(write.table_name).delete().eq('id', write.row_id)
      return error ? this.classify(error) : { status: 'applied' }
    }

    // phase_events and warmup_events are insert-only and their id is a server
    // sequence, so the local id must not be sent - the server assigns its own.
    if (write.table_name === 'phase_events' || write.table_name === 'warmup_events') {
      // The local id is a client-side sequence and means nothing here, so the
      // server assigns its own. client_id is what makes this safe to retry.
      const { id: _localId, ...event } = row
      const { error } = await this.client.from(write.table_name).insert(event)
      if (!error) return { status: 'applied' }

      if (error.code === '23505') {
        // The unique constraint on (user_id, client_id) caught a retry of a
        // push that had already landed. Nothing is wrong: the event is on the
        // server exactly once, which is the whole point of the key.
        return { status: 'applied' }
      }
      return this.classify(error)
    }

    const { error } = await this.client.from(write.table_name).upsert(row)
    if (!error) return { status: 'applied' }

    if (error.code === '23505') {
      // Something is already there under this key. Fetch it so the conflict is
      // resolved against the real row rather than guessed at.
      const remote = await this.fetchRow(write.table_name, write.row_id)
      if (remote) return { status: 'conflict', remote }
    }

    return this.classify(error)
  }

  async pull(since: string | null): Promise<{ changes: RemoteChange[]; serverTime: string }> {
    if (!this.client) throw new Error('No Supabase client configured.')

    const changes: RemoteChange[] = []

    for (const table of MIRRORED_TABLE_NAMES) {
      const column = PULL_CURSOR_COLUMN[table]
      let query = this.client.from(table).select('*')
      if (since !== null) query = query.gt(column, since)

      const { data, error } = await query.order(column, { ascending: true })
      if (error) throw new Error(`Pulling ${table} failed: ${error.message}`)

      for (const row of data ?? []) {
        changes.push({ table, row: row as Record<string, unknown> })
      }
    }

    return { changes, serverTime: new Date().toISOString() }
  }

  private async fetchRow(
    table: TableName,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.client) return null
    const key = table === 'user_settings' ? 'user_id' : 'id'
    const { data, error } = await this.client.from(table).select('*').eq(key, id).maybeSingle()
    if (error || !data) return null
    return data as Record<string, unknown>
  }

  private classify(error: { code?: string; message: string }): PushOutcome {
    if (error.code && PERMANENT_CODES.has(error.code)) {
      return { status: 'rejected', reason: `${error.code}: ${error.message}` }
    }
    return { status: 'unavailable', reason: error.message }
  }
}
