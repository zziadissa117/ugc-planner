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
import MIGRATION_0002 from '../../docs/migrations/0002_phase_events_client_id.sql?raw'

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
      'campaign_accounts',
      'campaign_angles',
      'campaign_documents',
      'campaign_fields',
      'campaign_hooks',
      'campaign_rules',
      'campaigns',
      'phase_events',
      'time_estimates',
      'user_settings',
      'video_posts',
      'videos',
      'warmup_events',
      'work_sessions',
    ])
  })

  it('creates every enum the generated types are built from', async () => {
    const types = await db.query<{ typname: string }>(
      `select typname from pg_type where typtype = 'e' order by typname`,
    )
    expect(types.rows.map((r) => r.typname)).toEqual([
      'account_status',
      'approval_mode',
      'document_kind',
      'field_source',
      'hook_source',
      'session_type',
      'setup_type',
      'video_kind',
      'video_phase',
    ])
  })

  it('enables row level security on all mirrored tables', async () => {
    const rls = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
    )
    expect(rls.rows).toHaveLength(16)
  })

  it.each(['phase_events', 'warmup_events'])(
    'makes %s insert-and-select only, with no update or delete policy',
    async (table) => {
      const policies = await db.query<{ cmd: string }>(
        `select cmd from pg_policies where tablename = '${table}'`,
      )
      const commands = policies.rows.map((r) => r.cmd).sort()
      // History is appended to and read from. There is no policy that would
      // let it be edited or erased.
      expect(commands).toEqual(['INSERT', 'SELECT'])
    },
  )
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

  it('refuses a warm-up session of zero minutes', async () => {
    const campaignId = await insertCampaign()
    await expect(
      db.exec(`insert into warmup_events (user_id, campaign_id, minutes)
               values ('${USER}', '${campaignId}', 0)`),
    ).rejects.toThrow()
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

  it('refuses a second phase_event under the same client_id', async () => {
    const campaignId = await insertCampaign()
    const video = await db.query<{ id: string }>(
      `insert into videos (user_id, campaign_id) values ('${USER}', '${campaignId}') returning id`,
    )
    const key = '22222222-2222-4222-8222-222222222222'
    const insert = `insert into phase_events (user_id, video_id, to_phase, client_id)
                    values ('${USER}', '${video.rows[0].id}', 'filmed', '${key}')`

    await db.exec(insert)
    // A push that succeeded but whose response was lost is retried with the
    // same key. Postgres refuses it, and the sync target reads that refusal
    // as "already applied" - so the event exists exactly once.
    await expect(db.exec(insert)).rejects.toThrow()

    const count = await db.query<{ n: string }>(
      `select count(*) as n from phase_events where client_id = '${key}'`,
    )
    expect(Number(count.rows[0].n)).toBe(1)
  })

  it('mints a client_id when one is not supplied', async () => {
    const campaignId = await insertCampaign()
    const video = await db.query<{ id: string }>(
      `insert into videos (user_id, campaign_id) values ('${USER}', '${campaignId}') returning id`,
    )
    const event = await db.query<{ client_id: string | null }>(
      `insert into phase_events (user_id, video_id, to_phase)
       values ('${USER}', '${video.rows[0].id}', 'filmed') returning client_id`,
    )
    expect(event.rows[0].client_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('ships the filmed-but-unedited opening count as null', async () => {
    const settings = await db.query<{ opening_unedited_count: number | null }>(
      `insert into user_settings (user_id) values ('${USER}')
       returning opening_unedited_count`,
    )
    expect(settings.rows[0].opening_unedited_count).toBeNull()
  })
})


describe('docs/migrations/0002_phase_events_client_id.sql', () => {
  /** schema.sql as it stood before the client_id column existed, so the
   *  migration can be applied to the thing it is actually written for: a
   *  database that already ran migration 0001 without it. */
  const SCHEMA_0001 = (() => {
    const start = SCHEMA.indexOf('  -- Client-generated idempotency key.')
    const end = SCHEMA.indexOf('  unique (user_id, client_id)')
    let withoutColumn =
      SCHEMA.slice(0, start) + SCHEMA.slice(end + '  unique (user_id, client_id)'.length)
    // The column left a trailing comma on the line above it.
    withoutColumn = withoutColumn.replace(
      'duration_seconds integer check (duration_seconds >= 0),',
      'duration_seconds integer check (duration_seconds >= 0)',
    )

    // warmup_events is migration 0003, later than the client_id column above.
    // A database that only ran 0001 has none of it - table, index, RLS or
    // policies - so all four are stripped the same way.
    return withoutColumn
      .replace(/\r?\n-- Every completed account warm-up session\.[\s\S]*?create index on warmup_events \(account_id, occurred_at\);\r?\n/, '\n')
      .replace(/\r?\nalter table warmup_events\s+enable row level security;/, '')
      .replace(/\r?\n-- warmup_events is append-only in exactly the same way\.[\s\S]*?create policy warmup_events_append on warmup_events for insert to authenticated\r?\n  with check \(user_id = \(select auth\.uid\(\)\)\);(?:\r?\n)?/, '\n')
  })()
  it('is written against a schema that really lacks the column', () => {
    // Guards the regex above: if it silently stopped matching, the migration
    // test below would be applying 0002 to a database that already has the
    // column and passing for the wrong reason.
    expect(SCHEMA).toContain('client_id')
    expect(SCHEMA_0001).not.toContain('client_id')
  })

  it('adds the column and the constraint to a database that ran 0001', async () => {
    const old = new PGlite()
    try {
      await old.exec(SUPABASE_STUB)
      await old.exec(`insert into auth.users (id) values ('${USER}')`)
      await old.exec(SCHEMA_0001)

      await old.exec(MIGRATION_0002)

      const campaign = await old.query<{ id: string }>(
        `insert into campaigns (user_id, name) values ('${USER}', 'T') returning id`,
      )
      const video = await old.query<{ id: string }>(
        `insert into videos (user_id, campaign_id) values ('${USER}', '${campaign.rows[0].id}') returning id`,
      )
      const key = '33333333-3333-4333-8333-333333333333'
      const insert = `insert into phase_events (user_id, video_id, to_phase, client_id)
                      values ('${USER}', '${video.rows[0].id}', 'filmed', '${key}')`

      await old.exec(insert)
      await expect(old.exec(insert)).rejects.toThrow()
    } finally {
      await old.close()
    }
  }, 120_000)
})
