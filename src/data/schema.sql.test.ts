// Runs docs/schema.sql against a real Postgres.
//
// The schema is the authoritative shape of everything in the app, and until
// now nothing had ever executed it - it was checked by reading. PGlite is
// Postgres compiled to WASM, so this applies the actual DDL, with actual
// constraint enforcement, without needing Docker or a provisioned project.
//
// What this does NOT cover: Supabase's own machinery. auth.users and auth.uid()
// are stubbed below, and RLS policies are created but never exercised, because
// there is no authenticated role here to exercise them as. Those need the real
// project.

import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

// Imported as text rather than read off disk, so this runs the same file the
// type generator reads and needs no node filesystem types.
import SCHEMA from '../../docs/schema.sql?raw'

/** The pieces Supabase supplies that plain Postgres does not. */
const SUPABASE_STUB = `
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select '11111111-1111-4111-8111-111111111111'::uuid
$$;
create role authenticated;
`

const USER = '11111111-1111-4111-8111-111111111111'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  await db.exec(`insert into auth.users (id) values ('${USER}')`)
  await db.exec(SCHEMA)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function insertCampaign(overrides: Record<string, string> = {}) {
  const columns = { user_id: `'${USER}'`, name: `'Test'`, ...overrides }
  const keys = Object.keys(columns).join(', ')
  const values = Object.values(columns).join(', ')
  const result = await db.query<{ id: string }>(
    `insert into campaigns (${keys}) values (${values}) returning id`,
  )
  return result.rows[0].id
}

describe('docs/schema.sql', () => {
  it('applies cleanly to a real Postgres', async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    )
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'bonus_claims',
      'bonus_tiers',
      'campaign_angles',
      'campaign_documents',
      'campaign_fields',
      'campaign_rules',
      'campaigns',
      'phase_events',
      'time_estimates',
      'user_settings',
      'video_posts',
      'videos',
    ])
  })

  it('creates every enum the generated types are built from', async () => {
    const types = await db.query<{ typname: string }>(
      `select typname from pg_type where typtype = 'e' order by typname`,
    )
    expect(types.rows.map((r) => r.typname)).toEqual([
      'approval_mode',
      'document_kind',
      'field_source',
      'session_type',
      'setup_type',
      'video_kind',
      'video_phase',
    ])
  })

  it('enables row level security on all twelve tables', async () => {
    const rls = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
    )
    expect(rls.rows).toHaveLength(12)
  })

  it('makes phase_events insert-and-select only, with no update or delete policy', async () => {
    const policies = await db.query<{ cmd: string }>(
      `select cmd from pg_policies where tablename = 'phase_events'`,
    )
    const commands = policies.rows.map((r) => r.cmd).sort()
    // History is appended to and read from. There is no policy that would let
    // it be edited or erased.
    expect(commands).toEqual(['INSERT', 'SELECT'])
  })
})

describe('the constraints the local store mirrors', () => {
  it('refuses a negative rate', async () => {
    await expect(insertCampaign({ pay_per_video_cents: '-1' })).rejects.toThrow()
  })

  it('refuses a cycle size of zero', async () => {
    await expect(insertCampaign({ cycle_size: '0' })).rejects.toThrow()
  })

  it('refuses a posted video with no posted_at', async () => {
    const campaignId = await insertCampaign()
    await expect(
      db.exec(`insert into videos (user_id, campaign_id, phase)
               values ('${USER}', '${campaignId}', 'posted')`),
    ).rejects.toThrow()
  })

  it('accepts a posted video with no rate - unpriced, not free', async () => {
    const campaignId = await insertCampaign()
    // This is the posted_is_timestamped relaxation. It must hold in Postgres
    // exactly as it holds in the local store.
    await expect(
      db.exec(`insert into videos (user_id, campaign_id, phase, posted_at)
               values ('${USER}', '${campaignId}', 'posted', now())`),
    ).resolves.not.toThrow()
  })

  it('refuses a documented field with no quote', async () => {
    const campaignId = await insertCampaign()
    await expect(
      db.exec(`insert into campaign_fields (user_id, campaign_id, field_key, field_value, source, confirmed_at)
               values ('${USER}', '${campaignId}', 'rate', '3500', 'documented', now())`),
    ).rejects.toThrow()
  })

  it('refuses a parsed field that claims to be confirmed', async () => {
    const campaignId = await insertCampaign()
    await expect(
      db.exec(`insert into campaign_fields (user_id, campaign_id, field_key, field_value, source, source_quote, confirmed_at)
               values ('${USER}', '${campaignId}', 'rate', '3500', 'parsed_unreviewed', 'q', now())`),
    ).rejects.toThrow()
  })

  it('refuses a missing field that holds a value', async () => {
    const campaignId = await insertCampaign()
    await expect(
      db.exec(`insert into campaign_fields (user_id, campaign_id, field_key, field_value, source)
               values ('${USER}', '${campaignId}', 'rate', '3500', 'missing')`),
    ).rejects.toThrow()
  })

  it('refuses a second field row for the same key on one campaign', async () => {
    const campaignId = await insertCampaign()
    const insert = `insert into campaign_fields (user_id, campaign_id, field_key, source)
                    values ('${USER}', '${campaignId}', 'handle', 'user_entered')`
    await db.exec(insert)
    await expect(db.exec(insert)).rejects.toThrow()
  })

  it('refuses a bonus probability above 1', async () => {
    const campaignId = await insertCampaign()
    const video = await db.query<{ id: string }>(
      `insert into videos (user_id, campaign_id) values ('${USER}', '${campaignId}') returning id`,
    )
    const tier = await db.query<{ id: string }>(
      `insert into bonus_tiers (user_id, campaign_id, label, threshold_views, payout_cents)
       values ('${USER}', '${campaignId}', '50k', 50000, 5000) returning id`,
    )
    await expect(
      db.exec(`insert into bonus_claims (user_id, video_id, bonus_tier_id, probability)
               values ('${USER}', '${video.rows[0].id}', '${tier.rows[0].id}', 1.5)`),
    ).rejects.toThrow()
  })

  it('refuses received bonus money with no date', async () => {
    const campaignId = await insertCampaign()
    const video = await db.query<{ id: string }>(
      `insert into videos (user_id, campaign_id) values ('${USER}', '${campaignId}') returning id`,
    )
    const tier = await db.query<{ id: string }>(
      `insert into bonus_tiers (user_id, campaign_id, label, threshold_views, payout_cents)
       values ('${USER}', '${campaignId}', '100k', 100000, 10000) returning id`,
    )
    await expect(
      db.exec(`insert into bonus_claims (user_id, video_id, bonus_tier_id, received_cents)
               values ('${USER}', '${video.rows[0].id}', '${tier.rows[0].id}', 5000)`),
    ).rejects.toThrow()
  })

  it('defaults a bonus probability to zero', async () => {
    const campaignId = await insertCampaign()
    const video = await db.query<{ id: string }>(
      `insert into videos (user_id, campaign_id) values ('${USER}', '${campaignId}') returning id`,
    )
    const tier = await db.query<{ id: string }>(
      `insert into bonus_tiers (user_id, campaign_id, label, threshold_views, payout_cents)
       values ('${USER}', '${campaignId}', '50k', 50000, 5000) returning id`,
    )
    const claim = await db.query<{ probability: string }>(
      `insert into bonus_claims (user_id, video_id, bonus_tier_id)
       values ('${USER}', '${video.rows[0].id}', '${tier.rows[0].id}') returning probability`,
    )
    expect(Number(claim.rows[0].probability)).toBe(0)
  })

  it('ships the filmed-but-unedited opening count as null', async () => {
    const settings = await db.query<{ opening_unedited_count: number | null }>(
      `insert into user_settings (user_id) values ('${USER}')
       returning opening_unedited_count`,
    )
    expect(settings.rows[0].opening_unedited_count).toBeNull()
  })
})
