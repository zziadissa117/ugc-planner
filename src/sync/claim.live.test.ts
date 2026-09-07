// Claiming local rows against a real first sign-in, over real HTTP.
//
// src/sync/claim.test.ts already proves the logic against a real LocalAdapter
// with a fake standing in for "who is signed in?" - the last unverified piece
// per docs/SYNC.md was doing this against an actual Supabase account and
// draining through the actual SupabaseSyncTarget, so a push RLS would refuse
// shows up here as a real rejection rather than a fake one that agrees with
// itself. That is the failure this whole mechanism exists to prevent: a
// refused push looks from the outside exactly like a successful one with
// nothing to send.
//
// Excluded from the default suite - it needs the network and it writes to a
// real project. Run it with `npm run test:live`.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { claimLocalRows, type AuthLike } from './claim'
import { drainOutbox } from './engine'
import { SupabaseSyncTarget } from './supabaseTarget'

const URL = import.meta.env.VITE_SUPABASE_URL as string
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

const LOCAL_ID = '00000000-0000-4000-8000-0000000000cc'
const PASSWORD = 'Claim-live-test-password-12345!'
const stamp = Date.now()
const email = `claim-live-${stamp}@ugcplanner.app`

let client: SupabaseClient
let accountId: string
let adapter: LocalAdapter
let campaignId: string

beforeAll(async () => {
  client = createClient(URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD })
  if (error) throw new Error(`signUp failed: ${error.message}`)
  if (!data.session) {
    throw new Error(
      'No session after signUp. Email confirmation must be off for this test to run - ' +
        'see docs/SYNC.md.',
    )
  }
  accountId = data.user!.id
})

afterAll(async () => {
  // Cascades cover everything hung off the campaign (videos, phase_events,
  // campaign_fields, angles, rules, bonus tiers). user_settings is keyed by
  // user_id directly and does not cascade from a campaign, so it is deleted
  // separately. The auth.users row itself cannot be deleted from here - no
  // admin key - and is left for manual cleanup, the same as the RLS live test.
  if (campaignId) await client.from('campaigns').delete().eq('id', campaignId)
  await client.from('user_settings').delete().eq('user_id', accountId)
  await client.auth.signOut()
})

describe('claiming local rows against a real account', () => {
  it('reassigns every row and drains without a single RLS rejection', async () => {
    indexedDB = new IDBFactory()
    const db = new LocalDatabase(`claim-live-${crypto.randomUUID()}`)
    adapter = new LocalAdapter(db, LOCAL_ID)
    await db.open()

    // Deliberately NOT seeded. ensureSeeded writes Inflow under a fixed id
    // shared by every install, so once one account holds that row no other
    // account can ever push it - RLS refuses, correctly, and the rejection
    // says nothing about the claim-and-drain path this test exists to check.
    const campaign = await adapter.createCampaign({
      name: 'Claim live test',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 3500,
      cycle_size: null,
    })
    campaignId = campaign.id
    const video = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(video.id, { session: 'film' })
    await adapter.updateUserSettings({ setup_switch_minutes: 12 })

    expect((await adapter.listPendingWrites()).length).toBeGreaterThan(0)

    const auth: AuthLike = { getAuthState: async () => ({ userId: accountId }) }
    const outcome = await claimLocalRows(adapter, auth)
    expect(outcome.status).toBe('claimed')

    const target = new SupabaseSyncTarget(client)
    const report = await drainOutbox(adapter, target, { batchSize: 1000 })

    // The notes carry the server's own words when something is refused, so a
    // failure here says which row and why rather than only "expected 0".
    expect(report.notes).toEqual([])
    expect(report.rejected).toBe(0)
    expect(report.applied).toBeGreaterThan(0)
    expect(await adapter.listPendingWrites()).toEqual([])

    // Confirm the rows really landed under this account, over HTTP, not just
    // that the local outbox thinks they did.
    const { data: remoteVideos, error } = await client
      .from('videos')
      .select('id, user_id')
      .eq('campaign_id', campaign.id)
    expect(error).toBeNull()
    expect(remoteVideos).toHaveLength(1)
    expect(remoteVideos![0].user_id).toBe(accountId)

    const { data: remoteEvents } = await client
      .from('phase_events')
      .select('id, user_id, to_phase')
      .eq('video_id', video.id)
    expect(remoteEvents!.every((e) => e.user_id === accountId)).toBe(true)
    expect(remoteEvents!.length).toBeGreaterThan(0)
  })
})
