// The fitting algorithm. SPEC section 8.
//
// Given a session type and a window, decide what to do and in what order, so
// that he does not have to. The output is a plan: existing videos to work,
// followed by new supply rows to create when the session is a FILM or WARM-UP
// one and time is left over.
//
// Pure. It reads rows and returns a plan; it writes nothing and asks nothing.
// materialiseSupply in ./supply is what turns the planned rows into real ones.

import type {
  BonusClaim,
  BonusTier,
  Campaign,
  PhaseEvent,
  SessionType,
  SetupType,
  TimeEstimate,
  Video,
  VideoKind,
} from '../data'
import { eligibleVideos, stageMinutes } from '../session'
import { FITTING_WEIGHTS } from './weights'

export { FITTING_WEIGHTS } from './weights'

/** An existing video the session should work. */
export interface PlannedVideo {
  kind: 'existing'
  video: Video
  campaign: Campaign
  setup: SetupType | null
  /** Minutes in this session's stage only - never the whole pipeline. */
  minutes: number
  score: number
  /** True when this item starts a new setup group and pays the switch cost. */
  costsSwitch: boolean
}

/** A video that does not exist yet, to be created as supply. */
export interface PlannedSupply {
  kind: 'supply'
  campaign: Campaign
  setup: SetupType | null
  videoKind: VideoKind
  minutes: number
  score: number
  costsSwitch: boolean
}

export type PlanItem = PlannedVideo | PlannedSupply

export interface SessionPlan {
  items: PlanItem[]
  /** Minutes the plan consumes, including every setup switch it pays for. */
  usedMinutes: number
  leftoverMinutes: number
  switchCount: number
  /** Eligible videos that did not fit in the window. */
  deferred: Video[]
}

export interface FitInput {
  session: SessionType
  windowMinutes: number
  videos: readonly Video[]
  campaigns: readonly Campaign[]
  estimates: readonly TimeEstimate[]
  setupSwitchMinutes: number
  /** Today, as YYYY-MM-DD, for deciding what the quota owes. */
  today: string
  /** When each video became ready to post, derived from phase_events. Only used
   *  in a POST session, to surface stock that is going stale. */
  readyAt?: ReadonlyMap<string, string>
  bonusTiers?: readonly BonusTier[]
  bonusClaims?: readonly BonusClaim[]
  now?: Date
}

/** When each video became ready to post, read off the append-only log. */
export function readyAtFromEvents(events: readonly PhaseEvent[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    // The most recent arrival at `approved` is the one that counts: a video
    // sent back and re-approved has not been sitting there the whole time.
    if (event.to_phase === 'edited') out.set(event.video_id, event.occurred_at)
    else if (event.from_phase === 'edited') out.delete(event.video_id)
  }
  return out
}

const dollars = (cents: number | null): number => (cents ?? 0) / 100

/** Expected bonus for a video: payout times the probability the user typed.
 *  Zero until he judges one, because every probability defaults to zero and
 *  none is ever inferred. */
function bonusUpsideDollars(
  videoId: string,
  tiers: readonly BonusTier[],
  claims: readonly BonusClaim[],
): number {
  let total = 0
  for (const claim of claims) {
    if (claim.video_id !== videoId) continue
    const tier = tiers.find((t) => t.id === claim.bonus_tier_id)
    if (!tier) continue
    total += dollars(tier.payout_cents) * claim.probability
  }
  return total
}

/** Score for an existing video, before any setup consideration. */
function scoreVideo(video: Video, campaign: Campaign, minutes: number, input: FitInput): number {
  const w = FITTING_WEIGHTS
  let score = 0

  // Contracted work owed today. The dominant term.
  if (video.kind === 'contracted' && video.owed_for_date === input.today) {
    score += w.owedToday
  }

  const pay = dollars(campaign.pay_per_video_cents)
  score += pay * w.payPerVideoPerDollar
  if (minutes > 0) score += (pay / minutes) * w.payPerMinutePerDollar

  score +=
    bonusUpsideDollars(video.id, input.bonusTiers ?? [], input.bonusClaims ?? []) *
    w.bonusUpsidePerDollar

  // In a POST session, approved stock that has been waiting is what is most at
  // risk: it was cleared to go out and is earning nothing while it sits.
  if (input.session === 'post') {
    const ready = input.readyAt?.get(video.id)
    if (ready) {
      const days = Math.max(
        0,
        Math.floor(((input.now ?? new Date()).getTime() - Date.parse(ready)) / 86_400_000),
      )
      score += days * w.readyAgingPerDay
    }
  }

  return score
}

/** Score for a not-yet-existing supply video. */
function scoreSupply(campaign: Campaign, minutes: number): number {
  const w = FITTING_WEIGHTS
  const pay = dollars(campaign.pay_per_video_cents)
  let score = w.newSupply + pay * w.payPerVideoPerDollar
  if (minutes > 0) score += (pay / minutes) * w.payPerMinutePerDollar
  return score
}

/** What kind a new supply video takes. Follows the campaign, never a guess. */
export function supplyKind(session: SessionType, campaign: Campaign): VideoKind {
  if (session === 'warm_up') return 'warm_up'
  return campaign.daily_post_quota > 0 ? 'contracted' : 'no_quota'
}

/** Only existing videos go through the greedy pool; new supply is packed
 *  separately once the pool is exhausted. */
interface Candidate {
  item: Omit<PlannedVideo, 'costsSwitch'>
  setup: SetupType | null
  minutes: number
  score: number
}

/** Packs by setup group, one whole group at a time. SPEC step 3.
 *
 *  Picking the single highest-scoring video first and batching afterwards
 *  looks equivalent and is not: it strands the window. Taking one 8 minute
 *  screen video out of 25 minutes leaves 17, and a 12 minute face video plus a
 *  10 minute switch no longer fits - so the evening ends with one video where
 *  two would have fitted in a single setup.
 *
 *  So each round asks a different question: not "which video is best?" but
 *  "which setup is worth being in?" Every group is costed as a whole - what it
 *  would contribute within the time left, after paying to switch into it - and
 *  the best group is committed in one go. Runs of a setup come out grouped
 *  because they were chosen as groups, and a switch has to be worth more than
 *  the minutes and the penalty it costs.
 *
 *  Mutates `pool` (removing what it takes) and the running totals. */
function packByGroups(
  pool: Candidate[],
  state: { remaining: number; setup: SetupType | null; switches: number },
  switchMinutes: number,
  chosen: PlanItem[],
): void {
  const w = FITTING_WEIGHTS

  for (;;) {
    const groups = new Map<SetupType, Candidate[]>()
    for (const candidate of pool) {
      if (candidate.setup === null) continue
      const members = groups.get(candidate.setup)
      if (members) members.push(candidate)
      else groups.set(candidate.setup, [candidate])
    }
    if (groups.size === 0) return

    let best: {
      setup: SetupType
      taken: Candidate[]
      adjusted: number
      switchCost: number
      changesSetup: boolean
    } | null = null

    for (const [setup, members] of groups) {
      const changesSetup = state.setup !== null && setup !== state.setup
      const switchCost = changesSetup ? switchMinutes : 0

      let budget = state.remaining - switchCost
      if (budget < 0) continue

      // What this group would actually contribute in the time left.
      const taken: Candidate[] = []
      let value = 0
      for (const candidate of [...members].sort((a, b) => b.score - a.score)) {
        if (candidate.minutes > budget) continue
        budget -= candidate.minutes
        taken.push(candidate)
        value += candidate.score
      }
      if (taken.length === 0) continue

      const adjusted =
        value + (changesSetup ? -switchMinutes * w.switchPenaltyPerMinute : w.sameSetup)

      if (!best || adjusted > best.adjusted) {
        best = { setup, taken, adjusted, switchCost, changesSetup }
      }
    }

    if (!best) return

    state.remaining -= best.switchCost
    if (best.changesSetup) state.switches++
    state.setup = best.setup

    best.taken.forEach((candidate, index) => {
      state.remaining -= candidate.minutes
      chosen.push({
        ...candidate.item,
        // Only the first video of a group pays for getting into that setup.
        costsSwitch: index === 0 && best.changesSetup,
      })
      pool.splice(pool.indexOf(candidate), 1)
    })
  }
}

export function fitSession(input: FitInput): SessionPlan {
  const campaignsById = new Map(input.campaigns.map((c) => [c.id, c]))
  const eligible = eligibleVideos(input.session, input.videos)

  const candidates: Candidate[] = []
  const untimed: Video[] = []

  for (const video of eligible) {
    const campaign = campaignsById.get(video.campaign_id)
    if (!campaign) continue

    const minutes = stageMinutes(input.session, video, input.estimates, campaign.default_setup)
    if (minutes === null) {
      // No setup on the video and none on the campaign, so there is no honest
      // estimate for it. It is not silently costed at some default - it is
      // simply not packed, and the caller can surface it as needing a setup.
      untimed.push(video)
      continue
    }

    const setup = video.setup ?? campaign.default_setup
    candidates.push({
      item: { kind: 'existing', video, campaign, setup, minutes, score: 0 },
      setup,
      minutes,
      score: scoreVideo(video, campaign, minutes, input),
    })
  }

  // Carry the computed score onto the item so callers can see why an order
  // came out the way it did.
  for (const candidate of candidates) candidate.item.score = candidate.score

  // Step 2, as three passes rather than a score comparison.
  //
  // "Contracted work owed today" is first in SPEC's priority order, and it has
  // to beat everything - including a campaign that happens to pay ten times as
  // much. A weight cannot promise that: make owedToday large enough to outrank
  // a $200 video and it is arbitrary, leave it smaller and a rich optional
  // video quietly takes tonight's obligated slot. So the tiers are structural.
  // A later pass can only ever use time an earlier pass did not want.
  const owedToday = candidates.filter(
    (c) => c.item.video.kind === 'contracted' && c.item.video.owed_for_date === input.today,
  )
  const contractedSupply = candidates.filter(
    (c) => c.item.video.kind === 'contracted' && c.item.video.owed_for_date !== input.today,
  )
  // Optional work must never take a slot a paid video could have used.
  const optional = candidates.filter((c) => c.item.video.kind !== 'contracted')

  const state = { remaining: input.windowMinutes, setup: null as SetupType | null, switches: 0 }
  const items: PlanItem[] = []

  packByGroups(owedToday, state, input.setupSwitchMinutes, items)
  packByGroups(contractedSupply, state, input.setupSwitchMinutes, items)
  packByGroups(optional, state, input.setupSwitchMinutes, items)

  // Step 6: fill whatever is left with new supply, but only in the sessions
  // that actually make videos. He never picks a count - the window decides.
  if (input.session === 'film' || input.session === 'warm_up') {
    packSupply(input, state, items)
  }

  const chosenVideoIds = new Set(
    items.filter((i): i is PlannedVideo => i.kind === 'existing').map((i) => i.video.id),
  )

  return {
    items,
    usedMinutes: input.windowMinutes - state.remaining,
    leftoverMinutes: state.remaining,
    switchCount: state.switches,
    deferred: [...eligible.filter((v) => !chosenVideoIds.has(v.id)), ...untimed],
  }
}

/** Keeps adding new supply videos until the next one would not fit.
 *
 *  Regenerates the candidate list each round because taking one more video
 *  from a campaign does not exhaust it - he can film several in a row in the
 *  same setup, which is exactly what the batching should encourage. */
function packSupply(
  input: FitInput,
  state: { remaining: number; setup: SetupType | null; switches: number },
  items: PlanItem[],
): void {
  const w = FITTING_WEIGHTS

  for (;;) {
    let best: {
      campaign: Campaign
      setup: SetupType | null
      minutes: number
      score: number
      adjusted: number
      cost: number
      switches: boolean
    } | null = null

    for (const campaign of input.campaigns) {
      const setup = campaign.default_setup
      if (setup === null) continue // no setup, no honest estimate

      const estimate = input.estimates.find((e) => e.setup === setup)
      if (!estimate) continue
      const minutes = estimate.film_minutes

      const changesSetup = state.setup !== null && setup !== state.setup
      const cost = minutes + (changesSetup ? input.setupSwitchMinutes : 0)
      if (cost > state.remaining) continue

      const score = scoreSupply(campaign, minutes)
      const adjusted =
        score +
        (changesSetup ? -input.setupSwitchMinutes * w.switchPenaltyPerMinute : w.sameSetup)

      if (!best || adjusted > best.adjusted) {
        best = { campaign, setup, minutes, score, adjusted, cost, switches: changesSetup }
      }
    }

    if (!best) return

    state.remaining -= best.cost
    if (best.switches) state.switches++
    state.setup = best.setup

    items.push({
      kind: 'supply',
      campaign: best.campaign,
      setup: best.setup,
      videoKind: supplyKind(input.session, best.campaign),
      minutes: best.minutes,
      score: best.score,
      costsSwitch: best.switches,
    })
  }
}
