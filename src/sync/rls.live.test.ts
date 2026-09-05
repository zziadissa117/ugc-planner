// Two real accounts, over HTTP, against the live project.
//
// docs/rls-check.sql already proves the policies themselves, running as the
// `authenticated` role with real JWT claims. This covers the layer above that:
// that supabase-js actually sends the token which produces those claims, and
// that PostgREST enforces them on a real request.
//
// Excluded from the default suite - it needs the network and it writes to a
// real project. Run it with `npm run test:live`.
//
// It needs two accounts that can actually sign in. If email confirmation is on,
// signUp returns a user but no session and these tests fail with a message
// saying exactly that, rather than passing vacuously.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const URL = import.meta.env.VITE_SUPABASE_URL as string
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

const PASSWORD = 'Rls-live-test-password-12345!'
const stamp = Date.now()

interface Account {
  client: SupabaseClient
  userId: string
  email: string
}

async function makeAccount(label: string): Promise<Account> {
  const client = createClient(URL, KEY, { auth: { persistSession: false } })
  const email = `rls-${label}-${stamp}@ugcplanner.app`

  const { data, error } = await client.auth.signUp({ email, password: PASSWORD })
  if (error) throw new Error(`signUp failed for ${label}: ${error.message}`)

  if (!data.session) {
    throw new Error(
      `No session for ${label}. Email confirmation is on, so signUp cannot ` +
        'produce a signed-in client. Turn off Authentication -> Providers -> ' +
        'Email -> Confirm email, or supply two confirmed accounts.',
    )
  }

  return { client, userId: data.user!.id, email }
}

let a: Account
let b: Account
let campaignId: string
let videoId: string

beforeAll(async () => {
  a = await makeAccount('a')
  b = await makeAccount('b')

  // A owns a campaign, a video and one history event.
  const campaign = await a.client
    .from('campaigns')
    .insert({ user_id: a.userId, name: 'A campaign' })
    .select()
    .single()
  if (campaign.error) throw new Error(`A could not create a campaign: ${campaign.error.message}`)
  campaignId = campaign.data.id as string

  const video = await a.client
    .from('videos')
    .insert({ user_id: a.userId, campaign_id: campaignId })
    .select()
    .single()
  if (video.error) throw new Error(`A could not create a video: ${video.error.message}`)
  videoId = video.data.id as string

  const event = await a.client
    .from('phase_events')
    .insert({ user_id: a.userId, video_id: videoId, to_phase: 'to_film' })
  if (event.error) throw new Error(`A could not record history: ${event.error.message}`)
}, 60_000)

afterAll(async () => {
  // Cascades to videos and phase_events.
  if (campaignId) await a?.client.from('campaigns').delete().eq('id', campaignId)
  await a?.client.auth.signOut()
  await b?.client.auth.signOut()
})

describe('account isolation over HTTP', () => {
  it('lets A see its own rows', async () => {
    // Asserted before B looks, so B's empty results below cannot be an empty
    // table passing for isolation.
    const { data, error } = await a.client.from('campaigns').select('*').eq('id', campaignId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('shows B nothing of A across every table', async () => {
    for (const table of ['campaigns', 'videos', 'phase_events'] as const) {
      const { data, error } = await b.client.from(table).select('*')
      expect(error, `${table} query errored`).toBeNull()
      expect(data, `B saw rows in ${table}`).toEqual([])
    }
  })

  it('will not let B fetch A row by its id', async () => {
    const { data } = await b.client.from('campaigns').select('*').eq('id', campaignId)
    // Knowing the id is not authorisation.
    expect(data).toEqual([])
  })

  it('will not let B write a row labelled as A', async () => {
    const { error } = await b.client
      .from('campaigns')
      .insert({ user_id: a.userId, name: 'forged by B' })
    expect(error).not.toBeNull()
  })

  it('will not let B modify or delete A rows', async () => {
    await b.client.from('campaigns').update({ name: 'renamed by B' }).eq('id', campaignId)
    await b.client.from('campaigns').delete().eq('id', campaignId)

    const { data } = await a.client.from('campaigns').select('name').eq('id', campaignId)
    expect(data?.[0]?.name).toBe('A campaign')
  })
})

describe('phase_events is append-only over HTTP', () => {
  it('lets the owner read and append', async () => {
    const { data, error } = await a.client.from('phase_events').select('*').eq('video_id', videoId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('refuses UPDATE even for the account that owns the row', async () => {
    const before = await a.client.from('phase_events').select('to_phase').eq('video_id', videoId)

    await a.client.from('phase_events').update({ to_phase: 'posted' }).eq('video_id', videoId)

    const after = await a.client.from('phase_events').select('to_phase').eq('video_id', videoId)
    // There is no UPDATE policy, and RLS denies any command without one. The
    // row is simply not visible to the command, so nothing changes.
    expect(after.data).toEqual(before.data)
  })

  it('refuses DELETE even for the account that owns the row', async () => {
    await a.client.from('phase_events').delete().eq('video_id', videoId)

    const { data } = await a.client.from('phase_events').select('*').eq('video_id', videoId)
    // History cannot be erased to cover a mistake. This is the guarantee the
    // MEASURED timings rest on.
    expect(data).toHaveLength(1)
  })
})

describe('the idempotency key', () => {
  it('refuses a second event under the same client_id', async () => {
    const clientId = crypto.randomUUID()
    const row = {
      user_id: a.userId,
      video_id: videoId,
      to_phase: 'filmed' as const,
      client_id: clientId,
    }

    const first = await a.client.from('phase_events').insert(row)
    expect(first.error).toBeNull()

    const retry = await a.client.from('phase_events').insert(row)
    // This is the shape SupabaseSyncTarget reads as "already applied": a lost
    // response, retried, must not duplicate the event.
    expect(retry.error?.code).toBe('23505')

    const { data } = await a.client.from('phase_events').select('*').eq('client_id', clientId)
    expect(data).toHaveLength(1)
  })
})
