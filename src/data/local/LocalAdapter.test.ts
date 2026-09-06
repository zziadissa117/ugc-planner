// Tests for the invariants the spec refuses to bend on: money in integer
// cents, a non-rewritable ledger, append-only history, rows that hold still
// under a thumb, and a backup that either restores completely or not at all.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConstraintError } from '../constraints'
import type { NewCampaign, NewVideo } from '../schema'
import { LocalDatabase } from './db'
import { BACKUP_FORMAT_VERSION, DataError, LocalAdapter } from './LocalAdapter'

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: LocalAdapter
let db: LocalDatabase

beforeEach(async () => {
  // A brand-new IndexedDB per test, so "freshly reset" means what it says.
  indexedDB = new IDBFactory()
  db = new LocalDatabase(`test-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

/** A campaign shaped like Inflow's approval route, but with no real campaign
 *  content in it - these are test fixtures, not seed data. */
async function makeCampaign(overrides: Partial<NewCampaign> = {}) {
  return adapter.createCampaign({
    name: 'Test campaign',
    company: null,
    default_setup: 'face',
    approval_mode: 'video',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: 60,
    ...overrides,
  })
}

async function makeVideo(campaignId: string, overrides: Partial<NewVideo> = {}) {
  return adapter.createVideo({
    campaign_id: campaignId,
    setup: 'face',
    angle_id: null,
    script: null,
    blocked_reason: null,
    owed_for_date: null,
    rate_snapshot_cents: null,
    posted_at: null,
    ...overrides,
  })
}

/** Walk a video forward until it reaches `target`. */
async function advanceTo(videoId: string, target: string) {
  for (let i = 0; i < 10; i++) {
    const video = await adapter.advanceVideoPhase(videoId)
    if (video.phase === target) return video
  }
  throw new Error(`never reached ${target}`)
}

describe('a fresh store', () => {
  it('has an empty ledger and no fabricated history', async () => {
    expect(await adapter.listCampaigns()).toEqual([])
    expect(await adapter.listVideos()).toEqual([])
    expect(await adapter.listPhaseEvents()).toEqual([])
    expect(await adapter.listBonusClaims()).toEqual([])
  })

  it('leaves the filmed-but-unedited opening count blank rather than guessing', async () => {
    const settings = await adapter.getUserSettings()
    expect(settings.opening_unedited_count).toBeNull()
    expect(settings.last_export_at).toBeNull()
  })

  it('seeds the EST times from the spec, all four setups', async () => {
    const estimates = await adapter.listTimeEstimates()
    expect(estimates).toHaveLength(4)
    const face = estimates.find((e) => e.setup === 'face')
    expect(face).toMatchObject({ film_minutes: 12, edit_minutes: 15, post_minutes: 5 })
  })
})

describe('the phase chain', () => {
  it('films, edits and posts, whatever the campaign approval route says', async () => {
    // This used to walk 'video' campaigns through submitted and approved. The
    // app is never told when a brand approves anything - that happens in
    // SideShift and WhatsApp - so those phases were places a video went to
    // stop. Approval route no longer changes the chain.
    for (const approval_mode of ['none', 'video', 'script_and_video', 'brand_scripted'] as const) {
      const campaign = await makeCampaign({ approval_mode })
      const video = await makeVideo(campaign.id)

      const seen = [video.phase]
      for (let i = 0; i < 3; i++) seen.push((await adapter.advanceVideoPhase(video.id)).phase)

      expect(seen).toEqual(['to_film', 'filmed', 'edited', 'posted'])
      expect(seen).not.toContain('submitted')
      expect(seen).not.toContain('approved')
    }
  })

  it('never submits a warm-up video', async () => {
    const campaign = await makeCampaign({ approval_mode: 'video' })
    const video = await makeVideo(campaign.id, { kind: 'warm_up' })

    const seen = [video.phase]
    for (let i = 0; i < 3; i++) seen.push((await adapter.advanceVideoPhase(video.id)).phase)

    expect(seen).toEqual(['to_film', 'filmed', 'edited', 'posted'])
    expect(seen).not.toContain('submitted')
    expect(seen).not.toContain('approved')
  })

  it('refuses to advance past the end of the chain', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none' })
    const video = await makeVideo(campaign.id)
    await advanceTo(video.id, 'posted')

    await expect(adapter.advanceVideoPhase(video.id)).rejects.toBeInstanceOf(DataError)
  })
})

describe('the rate snapshot', () => {
  it('locks in the campaign rate when the video is posted', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none', pay_per_video_cents: 3500 })
    const video = await makeVideo(campaign.id)
    const posted = await advanceTo(video.id, 'posted')

    expect(posted.rate_snapshot_cents).toBe(3500)
    expect(posted.posted_at).not.toBeNull()
  })

  it('does not let a later rate change rewrite what past work earned', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none', pay_per_video_cents: 3500 })
    const video = await makeVideo(campaign.id)
    await advanceTo(video.id, 'posted')

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 5000 })

    const after = await adapter.getVideo(video.id)
    expect(after?.rate_snapshot_cents).toBe(3500)
  })

  it('is integer cents, never a float', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none', pay_per_video_cents: 3500 })
    const video = await makeVideo(campaign.id)
    const posted = await advanceTo(video.id, 'posted')

    expect(Number.isInteger(posted.rate_snapshot_cents)).toBe(true)
    await expect(
      adapter.updateCampaign(campaign.id, { pay_per_video_cents: 35.5 }),
    ).rejects.toBeInstanceOf(ConstraintError)
  })

  it('stays null when the campaign has no rate - unpriced, not free', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none', pay_per_video_cents: null })
    const video = await makeVideo(campaign.id)

    // The tap still goes through: an unconfirmed rate must never block work he
    // can do right now.
    const posted = await advanceTo(video.id, 'posted')

    expect(posted.posted_at).not.toBeNull()
    // Null, not 0. A zero here would be a fabricated "earned nothing" sitting
    // in the one table that must never carry an invented figure.
    expect(posted.rate_snapshot_cents).toBeNull()
  })

  it('is cleared when a post is undone, so re-posting takes a fresh rate', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none', pay_per_video_cents: 3500 })
    const video = await makeVideo(campaign.id)
    await advanceTo(video.id, 'posted')

    const reverted = await adapter.revertVideoPhase(video.id)
    expect(reverted.phase).toBe('edited')
    expect(reverted.rate_snapshot_cents).toBeNull()
    expect(reverted.posted_at).toBeNull()

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 5000 })
    const reposted = await adapter.advanceVideoPhase(video.id)
    expect(reposted.rate_snapshot_cents).toBe(5000)
  })
})

describe('history', () => {
  it('records every move, including the undo', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none' })
    const video = await makeVideo(campaign.id)

    await adapter.advanceVideoPhase(video.id, { session: 'film' })
    await adapter.revertVideoPhase(video.id)

    const events = await adapter.listPhaseEvents({ videoId: video.id })
    // Creation, the advance, and the undo. The undo is an addition, not an
    // erasure of the event it reverses.
    expect(events.map((e) => [e.from_phase, e.to_phase])).toEqual([
      [null, 'to_film'],
      ['to_film', 'filmed'],
      ['filmed', 'to_film'],
    ])
  })

  it('carries the session so measured timings can be split by session type', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none' })
    const video = await makeVideo(campaign.id)
    await adapter.advanceVideoPhase(video.id, { session: 'film', durationSeconds: 720 })

    const events = await adapter.listPhaseEvents({ videoId: video.id })
    expect(events[1]).toMatchObject({ session: 'film', duration_seconds: 720 })
  })

  it('offers no way to update or delete an event', () => {
    // The guarantee is structural: there is no verb for it on the interface.
    expect('updatePhaseEvent' in adapter).toBe(false)
    expect('deletePhaseEvent' in adapter).toBe(false)
  })
})

describe('rows hold still', () => {
  it('does not reorder the list when a video is marked posted', async () => {
    const campaign = await makeCampaign({ approval_mode: 'none' })
    await makeVideo(campaign.id)
    const b = await makeVideo(campaign.id)
    await makeVideo(campaign.id)

    // Whatever order the list comes back in, it is that order that must not
    // move. The assertion is stability, not any particular arrangement.
    const before = (await adapter.listVideos()).map((v) => v.id)
    expect(before).toHaveLength(3)

    // Advance one row all the way to posted - the most disruptive change a
    // single row can undergo.
    await advanceTo(b.id, 'posted')

    const after = await adapter.listVideos()
    expect(after.map((v) => v.id)).toEqual(before)
    // And it is still in the list, not removed.
    expect(after.find((v) => v.id === b.id)?.phase).toBe('posted')
  })
})

describe('provenance', () => {
  it('will not store a parsed field as documented', async () => {
    const campaign = await makeCampaign()
    await expect(
      adapter.setCampaignField({
        campaign_id: campaign.id,
        field_key: 'submission_url',
        field_value: 'https://example.test',
        source: 'documented',
        source_quote: 'something',
        source_document_id: null,
      }),
    ).rejects.toBeInstanceOf(DataError)
  })

  it('promotes a quoted field to documented when confirmed', async () => {
    const campaign = await makeCampaign()
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'pay_per_video',
      field_value: '3500',
      source: 'parsed_unreviewed',
      source_quote: '$35.00 per approved deliverable',
      source_document_id: null,
    })

    const confirmed = await adapter.confirmCampaignField(campaign.id, 'pay_per_video')
    expect(confirmed.source).toBe('documented')
    expect(confirmed.confirmed_at).not.toBeNull()
  })

  it('confirms an unquoted field as user_entered, not documented', async () => {
    const campaign = await makeCampaign()
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'handle_tiktok',
      field_value: '@someone',
      source: 'user_entered',
      source_quote: null,
      source_document_id: null,
    })

    const confirmed = await adapter.confirmCampaignField(campaign.id, 'handle_tiktok')
    // No document says this, so it is his word for it - which is not the same
    // claim as "the contract says so".
    expect(confirmed.source).toBe('user_entered')
  })

  it('keeps a missing field empty', async () => {
    const campaign = await makeCampaign()
    const field = await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'submission_url',
      field_value: null,
      source: 'missing',
      source_quote: null,
      source_document_id: null,
    })
    expect(field.field_value).toBeNull()

    await expect(adapter.confirmCampaignField(campaign.id, 'submission_url')).rejects.toBeInstanceOf(
      DataError,
    )
  })

  it('un-confirms a field when its value is changed', async () => {
    const campaign = await makeCampaign()
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'pay_per_video',
      field_value: '3500',
      source: 'parsed_unreviewed',
      source_quote: '$35.00 per approved deliverable',
      source_document_id: null,
    })
    await adapter.confirmCampaignField(campaign.id, 'pay_per_video')

    const rewritten = await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'pay_per_video',
      field_value: '4000',
      source: 'user_entered',
      source_quote: null,
      source_document_id: null,
    })
    expect(rewritten.confirmed_at).toBeNull()
  })
})

describe('bonus money', () => {
  it('defaults every probability to zero', async () => {
    const campaign = await makeCampaign()
    const tier = await adapter.addBonusTier({
      campaign_id: campaign.id,
      label: '50k views',
      threshold_views: 50_000,
      payout_cents: 5000,
      view_window_days: 30,
    })
    const video = await makeVideo(campaign.id)

    const claim = await adapter.setBonusProbability(video.id, tier.id, 0)
    expect(claim.probability).toBe(0)
    expect(claim.received_cents).toBeNull()
  })

  it('refuses a probability outside 0..1', async () => {
    const campaign = await makeCampaign()
    const tier = await adapter.addBonusTier({
      campaign_id: campaign.id,
      label: '100k views',
      threshold_views: 100_000,
      payout_cents: 10_000,
      view_window_days: 30,
    })
    const video = await makeVideo(campaign.id)

    await expect(adapter.setBonusProbability(video.id, tier.id, 1.5)).rejects.toBeInstanceOf(
      ConstraintError,
    )
  })

  it('will not log money as received without a date', async () => {
    const campaign = await makeCampaign()
    const tier = await adapter.addBonusTier({
      campaign_id: campaign.id,
      label: '50k views',
      threshold_views: 50_000,
      payout_cents: 5000,
      view_window_days: 30,
    })
    const video = await makeVideo(campaign.id)

    await expect(
      // @ts-expect-error - the interface requires a date; this asserts the
      // runtime guard holds even when a caller circumvents the types.
      adapter.recordBonusReceived(video.id, tier.id, 5000, null),
    ).rejects.toBeInstanceOf(ConstraintError)
  })
})

describe('foreign keys', () => {
  it('refuses a video attached to no campaign', async () => {
    await expect(makeVideo(crypto.randomUUID())).rejects.toBeInstanceOf(DataError)
  })
})

describe('backup', () => {
  it('round-trips every table', async () => {
    const campaign = await makeCampaign()
    const video = await makeVideo(campaign.id)
    await adapter.advanceVideoPhase(video.id, { session: 'film' })
    await adapter.addCampaignDocument({
      campaign_id: campaign.id,
      kind: 'contract',
      filename: 'contract.md',
      raw_text: 'Per-post compensation: $35.00 per approved deliverable',
    })

    const snapshot = await adapter.exportAll()
    const json = JSON.stringify(snapshot)

    // A different store entirely, restored from the text alone.
    const other = new LocalDatabase(`test-${crypto.randomUUID()}`)
    const restored = new LocalAdapter(other, USER)
    await restored.importAll(JSON.parse(json))

    expect(await restored.listCampaigns()).toEqual(await adapter.listCampaigns())
    expect(await restored.listVideos()).toEqual(await adapter.listVideos())
    expect(await restored.listPhaseEvents()).toEqual(await adapter.listPhaseEvents())
    expect(await restored.listCampaignDocuments(campaign.id)).toEqual(
      await adapter.listCampaignDocuments(campaign.id),
    )
  })

  it('keeps the raw document text verbatim', async () => {
    const campaign = await makeCampaign()
    const raw = 'Line one\n\n  ragged   OCR  Â garbage\nLine two'
    await adapter.addCampaignDocument({
      campaign_id: campaign.id,
      kind: 'brief',
      filename: 'brief.md',
      raw_text: raw,
    })

    const snapshot = await adapter.exportAll()
    expect(snapshot.campaign_documents[0].raw_text).toBe(raw)
  })

  it('refuses a snapshot from a format it does not read', async () => {
    await expect(adapter.importAll({ format_version: 999 })).rejects.toBeInstanceOf(DataError)
  })

  it('leaves the store untouched when a row in the snapshot is invalid', async () => {
    const campaign = await makeCampaign()
    const video = await makeVideo(campaign.id)
    const before = await adapter.listVideos()

    const snapshot = await adapter.exportAll()
    // A posted video that never says when it went live - what
    // posted_is_timestamped exists to stop, and the sort of corruption a
    // hand-edited backup could carry. Note rate_snapshot_cents null is fine on
    // its own; it is the missing posted_at that makes this row invalid.
    snapshot.videos.push({
      ...video,
      id: crypto.randomUUID(),
      phase: 'posted',
      posted_at: null,
      rate_snapshot_cents: null,
    })

    await expect(adapter.importAll(snapshot)).rejects.toBeInstanceOf(DataError)
    // Nothing was half-applied.
    expect(await adapter.listVideos()).toEqual(before)
  })

  it('treats a table missing from an older export as empty rather than failing', async () => {
    const snapshot = {
      format_version: BACKUP_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      campaigns: [],
    }
    const result = await adapter.importAll(snapshot)
    expect(result.counts.videos).toBe(0)
  })
})

describe('reset', () => {
  it('everything clears the ledger and the opening balance too', async () => {
    const campaign = await makeCampaign({ opening_post_count: 13 })
    const video = await makeVideo(campaign.id)
    await advanceTo(video.id, 'posted')

    await adapter.reset('everything')

    expect(await adapter.listCampaigns()).toEqual([])
    expect(await adapter.listVideos()).toEqual([])
    expect(await adapter.listPhaseEvents()).toEqual([])
    const settings = await adapter.getUserSettings()
    expect(settings.opening_unedited_count).toBeNull()
  })
})
