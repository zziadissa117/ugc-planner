// Turns the plan's supply entries into real video rows.
//
// Kept apart from fit.ts so the algorithm stays pure and testable: fitting
// decides, this writes.

import type { DataAdapter, Video } from '../data'
import type { PlannedSupply, SessionPlan } from './fit'

/** Creates a video row for every supply entry in the plan, in plan order.
 *
 *  owed_for_date is null on purpose - this is stock built ahead of demand, not
 *  an obligation for any particular day. Giving it today's date would invent a
 *  quota the campaign never set, and would make tonight's "X of Y posted" line
 *  wrong. */
export async function materialiseSupply(
  adapter: DataAdapter,
  plan: SessionPlan,
): Promise<Video[]> {
  const created: Video[] = []

  for (const item of plan.items) {
    if (item.kind !== 'supply') continue
    created.push(await createSupplyVideo(adapter, item))
  }

  return created
}

export async function createSupplyVideo(
  adapter: DataAdapter,
  item: PlannedSupply,
): Promise<Video> {
  return adapter.createVideo({
    campaign_id: item.campaign.id,
    // Follows the campaign, never a guess: warm_up in a warm-up session,
    // contracted where a daily quota exists, no_quota otherwise.
    kind: item.videoKind,
    setup: item.setup,
    angle_id: null,
    script: null,
    blocked_reason: null,
    // Supply, not an obligation.
    owed_for_date: null,
    rate_snapshot_cents: null,
    posted_at: null,
  })
}
