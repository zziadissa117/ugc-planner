// One test per step of SPEC section 8, plus the film-ahead behaviour.
//
// fitSession is pure, so these build rows by hand rather than going through a
// store: the point is the decision, not the persistence.

import { describe, expect, it } from 'vitest'

import type { Campaign, SessionType, TimeEstimate, Video } from '../data'
import { DEFAULT_TIME_ESTIMATES } from '../data'
import { approvedAtFromEvents, fitSession, supplyKind, type FitInput } from './fit'

const TODAY = '2026-09-04'
const USER = 'u'

const ESTIMATES: TimeEstimate[] = DEFAULT_TIME_ESTIMATES.map((e, i) => ({
  id: `est-${i}`,
  user_id: USER,
  ...e,
}))

let seq = 0

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  seq++
  return {
    id: `c${seq}`,
    user_id: USER,
    name: `Campaign ${seq}`,
    company: null,
    is_active: true,
    approval_mode: 'none',
    default_setup: 'face',
    daily_post_quota: 0,
    pay_per_video_cents: 3500,
    cycle_size: null,
    opening_post_count: 0,
    brief_is_incomplete: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function video(campaignId: string, overrides: Partial<Video> = {}): Video {
  seq++
  return {
    id: `v${seq}`,
    user_id: USER,
    campaign_id: campaignId,
    kind: 'contracted',
    setup: 'face',
    angle_id: null,
    phase: 'to_film',
    script: null,
    blocked_reason: null,
    owed_for_date: null,
    rate_snapshot_cents: null,
    posted_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function fit(overrides: Partial<FitInput> & Pick<FitInput, 'session' | 'windowMinutes'>) {
  return fitSession({
    videos: [],
    campaigns: [],
    estimates: ESTIMATES,
    setupSwitchMinutes: 10,
    today: TODAY,
    ...overrides,
  })
}

const existingIds = (plan: ReturnType<typeof fit>) =>
  plan.items.filter((i) => i.kind === 'existing').map((i) => (i.kind === 'existing' ? i.video.id : ''))

const supplyItems = (plan: ReturnType<typeof fit>) => plan.items.filter((i) => i.kind === 'supply')

describe('step 1 - scoring', () => {
  it('puts contracted work owed today ahead of everything else', () => {
    const paid = campaign({ pay_per_video_cents: 3500, daily_post_quota: 1 })
    // A far more lucrative video that is not owed today.
    const lucrative = campaign({ pay_per_video_cents: 20_000 })

    const owed = video(paid.id, { kind: 'contracted', owed_for_date: TODAY })
    const rich = video(lucrative.id, { kind: 'contracted', owed_for_date: null })

    const plan = fit({
      session: 'film',
      windowMinutes: 12, // room for exactly one
      videos: [rich, owed],
      campaigns: [paid, lucrative],
    })

    expect(existingIds(plan)[0]).toBe(owed.id)
  })

  it('front-loads approval-gated work over ungated work of the same pay', () => {
    const gated = campaign({ approval_mode: 'video' })
    const ungated = campaign({ approval_mode: 'none' })
    const a = video(ungated.id, { kind: 'no_quota' })
    const b = video(gated.id, { kind: 'no_quota' })

    const plan = fit({
      session: 'film',
      windowMinutes: 12,
      videos: [a, b],
      campaigns: [ungated, gated],
    })

    expect(existingIds(plan)[0]).toBe(b.id)
  })

  it('contributes no bonus upside until the user has typed a probability', () => {
    const c = campaign()
    const v = video(c.id, { kind: 'no_quota' })

    const withoutClaim = fit({ session: 'film', windowMinutes: 12, videos: [v], campaigns: [c] })
    const withZeroClaim = fit({
      session: 'film',
      windowMinutes: 12,
      videos: [v],
      campaigns: [c],
      bonusTiers: [
        {
          id: 't1',
          user_id: USER,
          campaign_id: c.id,
          label: '50k',
          threshold_views: 50_000,
          payout_cents: 5000,
          view_window_days: 30,
        },
      ],
      bonusClaims: [
        {
          id: 'b1',
          user_id: USER,
          video_id: v.id,
          bonus_tier_id: 't1',
          // The default. Never inferred from views or past performance.
          probability: 0,
          received_cents: null,
          received_at: null,
        },
      ],
    })

    const score = (p: ReturnType<typeof fit>) =>
      p.items[0].kind === 'existing' ? p.items[0].score : 0
    expect(score(withZeroClaim)).toBe(score(withoutClaim))
  })
})

describe('step 2 - contracted work is packed first', () => {
  it('never lets optional work take a slot a paid video could have used', () => {
    const paid = campaign({ daily_post_quota: 1, pay_per_video_cents: 3500 })
    const optional = campaign({ pay_per_video_cents: 9900 })

    const contracted = video(paid.id, { kind: 'contracted', owed_for_date: TODAY })
    const nice = video(optional.id, { kind: 'no_quota' })

    const plan = fit({
      session: 'film',
      windowMinutes: 12, // one video only
      videos: [nice, contracted],
      campaigns: [paid, optional],
    })

    expect(existingIds(plan)).toEqual([contracted.id])
    expect(plan.deferred.map((v) => v.id)).toContain(nice.id)
  })
})

describe('step 3 - setup batching', () => {
  it('groups by setup rather than interleaving', () => {
    const c = campaign({ default_setup: null })
    const faces = [video(c.id, { setup: 'face' }), video(c.id, { setup: 'face' })]
    const screens = [video(c.id, { setup: 'screen' }), video(c.id, { setup: 'screen' })]

    const plan = fit({
      session: 'film',
      windowMinutes: 300,
      // Deliberately interleaved on the way in.
      videos: [faces[0], screens[0], faces[1], screens[1]],
      campaigns: [c],
    })

    const setups = plan.items.map((i) => (i.kind === 'existing' ? i.setup : null))
    // One switch at most between two runs, never four alternations.
    const changes = setups.filter((s, i) => i > 0 && s !== setups[i - 1]).length
    expect(changes).toBe(1)
    expect(plan.switchCount).toBe(1)
  })

  it('charges the switch cost against the window', () => {
    const c = campaign({ default_setup: null })
    const face = video(c.id, { setup: 'face' }) // 12 film minutes
    const screen = video(c.id, { setup: 'screen' }) // 8 film minutes

    // 12 + 8 = 20 minutes of work, plus a 10 minute switch = 30.
    const tight = fit({
      session: 'film',
      windowMinutes: 25,
      videos: [face, screen],
      campaigns: [c],
    })
    expect(existingIds(tight)).toHaveLength(1)

    const roomy = fit({
      session: 'film',
      windowMinutes: 30,
      videos: [face, screen],
      campaigns: [c],
    })
    expect(existingIds(roomy)).toHaveLength(2)
    expect(roomy.usedMinutes).toBe(30)
  })

  it('does not strand the window by chasing the single best video first', () => {
    // 25 minutes. One screen video is the best single item at 8 minutes, but
    // taking it leaves 17 - not enough for a 12 minute face video plus a 10
    // minute switch - so the evening ends with one video. Two face videos fit
    // in 24 minutes with no switch at all.
    const c = campaign({ default_setup: null, pay_per_video_cents: 3500 })
    const screen = video(c.id, { setup: 'screen', kind: 'no_quota' })
    const faces = [
      video(c.id, { setup: 'face', kind: 'no_quota' }),
      video(c.id, { setup: 'face', kind: 'no_quota' }),
    ]

    const plan = fit({
      session: 'film',
      windowMinutes: 25,
      videos: [screen, ...faces],
      campaigns: [c],
    })

    expect(existingIds(plan)).toHaveLength(2)
    expect(plan.items.map((i) => (i.kind === 'existing' ? i.setup : null))).toEqual([
      'face',
      'face',
    ])
    expect(plan.switchCount).toBe(0)
  })

  it('lets the switch cost outweigh a small gain in value', () => {
    const cheap = campaign({ default_setup: null, pay_per_video_cents: 3500 })
    const slightlyBetter = campaign({ default_setup: null, pay_per_video_cents: 4000 })

    const inSetup = video(cheap.id, { setup: 'face', kind: 'no_quota' })
    const first = video(cheap.id, { setup: 'face', kind: 'no_quota' })
    const otherSetup = video(slightlyBetter.id, { setup: 'screen', kind: 'no_quota' })

    const plan = fit({
      session: 'film',
      windowMinutes: 40,
      videos: [first, otherSetup, inSetup],
      campaigns: [cheap, slightlyBetter],
    })

    const setups = plan.items.map((i) => (i.kind === 'existing' ? i.setup : null))
    // Both face videos come before the marginally better screen one.
    expect(setups.slice(0, 2)).toEqual(['face', 'face'])
  })
})

describe('step 4 - timed by this stage only', () => {
  it('costs an EDIT session in edit minutes, not film minutes', () => {
    const c = campaign({ default_setup: 'notalk' }) // film 8, edit 18
    const v = video(c.id, { phase: 'filmed', setup: 'notalk', kind: 'no_quota' })

    const plan = fit({ session: 'edit', windowMinutes: 20, videos: [v], campaigns: [c] })
    expect(plan.usedMinutes).toBe(18)
  })

  it('will not cost a video that has no setup anywhere', () => {
    const c = campaign({ default_setup: null })
    const v = video(c.id, { setup: null })

    const plan = fit({ session: 'film', windowMinutes: 300, videos: [v], campaigns: [c] })
    // No honest estimate exists, so it is deferred rather than costed at some
    // invented default.
    expect(plan.items).toHaveLength(0)
    expect(plan.deferred.map((x) => x.id)).toContain(v.id)
  })
})

describe('step 5 - a POST session prioritises what is at risk', () => {
  it('puts older approved stock first', () => {
    const c = campaign({ approval_mode: 'video' })
    const fresh = video(c.id, { phase: 'approved', kind: 'no_quota' })
    const stale = video(c.id, { phase: 'approved', kind: 'no_quota' })

    const plan = fit({
      session: 'post',
      windowMinutes: 5, // one post only
      videos: [fresh, stale],
      campaigns: [c],
      now: new Date('2026-09-04T20:00:00.000Z'),
      approvedAt: new Map([
        [fresh.id, '2026-09-04T08:00:00.000Z'],
        [stale.id, '2026-08-28T08:00:00.000Z'],
      ]),
    })

    expect(existingIds(plan)).toEqual([stale.id])
  })

  it('reads approval age off the append-only log', () => {
    const map = approvedAtFromEvents([
      { id: 1, user_id: USER, video_id: 'v1', from_phase: 'submitted', to_phase: 'approved', session: null, occurred_at: '2026-09-01T00:00:00.000Z', duration_seconds: null },
      // Sent back, then approved again - the second arrival is what counts.
      { id: 2, user_id: USER, video_id: 'v1', from_phase: 'approved', to_phase: 'edited', session: null, occurred_at: '2026-09-02T00:00:00.000Z', duration_seconds: null },
      { id: 3, user_id: USER, video_id: 'v1', from_phase: 'submitted', to_phase: 'approved', session: null, occurred_at: '2026-09-03T00:00:00.000Z', duration_seconds: null },
    ])
    expect(map.get('v1')).toBe('2026-09-03T00:00:00.000Z')
  })
})

describe('step 6 - filming ahead', () => {
  it('fills leftover FILM time with new supply', () => {
    const c = campaign({ daily_post_quota: 1, default_setup: 'face' }) // 12 film minutes
    const owed = video(c.id, { owed_for_date: TODAY })

    const plan = fit({
      session: 'film',
      windowMinutes: 90,
      videos: [owed],
      campaigns: [c],
    })

    // 90 minutes at 12 each, one of which is the owed video, all same setup so
    // no switches: 7 videos, 6 of them new supply.
    expect(plan.items).toHaveLength(7)
    expect(supplyItems(plan)).toHaveLength(6)
    expect(plan.leftoverMinutes).toBeLessThan(12)
  })

  it('works the owed video before making any new supply', () => {
    const c = campaign({ daily_post_quota: 1 })
    const owed = video(c.id, { owed_for_date: TODAY })

    const plan = fit({ session: 'film', windowMinutes: 60, videos: [owed], campaigns: [c] })
    expect(plan.items[0].kind).toBe('existing')
  })

  it('creates supply as stock, not as an obligation for today', () => {
    const c = campaign({ daily_post_quota: 1 })
    const plan = fit({ session: 'film', windowMinutes: 30, videos: [], campaigns: [c] })

    // The planner never assigns owed_for_date; supply.ts writes null.
    expect(supplyItems(plan).length).toBeGreaterThan(0)
    for (const item of supplyItems(plan)) {
      expect(item.kind).toBe('supply')
    }
  })

  it('takes the video kind from the campaign rather than guessing', () => {
    const quota = campaign({ daily_post_quota: 1 })
    const noQuota = campaign({ daily_post_quota: 0 })

    expect(supplyKind('film', quota)).toBe('contracted')
    expect(supplyKind('film', noQuota)).toBe('no_quota')
    expect(supplyKind('warm_up', quota)).toBe('warm_up')
  })

  it('makes no supply in an EDIT or POST session', () => {
    const c = campaign({ daily_post_quota: 1 })
    for (const session of ['edit', 'post'] as SessionType[]) {
      const plan = fit({ session, windowMinutes: 300, videos: [], campaigns: [c] })
      // Those sessions work the existing pipeline; they do not create videos.
      expect(supplyItems(plan)).toHaveLength(0)
    }
  })

  it('makes no supply for a campaign with no setup to film in', () => {
    const c = campaign({ default_setup: null, daily_post_quota: 1 })
    const plan = fit({ session: 'film', windowMinutes: 300, videos: [], campaigns: [c] })
    expect(supplyItems(plan)).toHaveLength(0)
  })

  it('never overruns the window', () => {
    const c = campaign({ daily_post_quota: 1 })
    for (const windowMinutes of [5, 13, 30, 47, 120]) {
      const plan = fit({ session: 'film', windowMinutes, videos: [], campaigns: [c] })
      expect(plan.usedMinutes).toBeLessThanOrEqual(windowMinutes)
      expect(plan.leftoverMinutes).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('session scoping', () => {
  it('a FILM session never proposes editing', () => {
    const c = campaign()
    const toEdit = video(c.id, { phase: 'filmed', kind: 'no_quota' })

    const plan = fit({ session: 'film', windowMinutes: 300, videos: [toEdit], campaigns: [c] })
    expect(existingIds(plan)).not.toContain(toEdit.id)
  })

  it('keeps warm-up content out of a paid FILM session', () => {
    const c = campaign({ default_setup: null, daily_post_quota: 0 })
    const warm = video(c.id, { kind: 'warm_up', setup: 'face' })

    const film = fit({ session: 'film', windowMinutes: 60, videos: [warm], campaigns: [c] })
    expect(existingIds(film)).not.toContain(warm.id)

    const warmUp = fit({ session: 'warm_up', windowMinutes: 60, videos: [warm], campaigns: [c] })
    expect(existingIds(warmUp)).toContain(warm.id)
  })
})
