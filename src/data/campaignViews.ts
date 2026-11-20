// A campaign's views, from the cutter's own readings - read only, never a
// tick. The cutter reads each posted video's views from Postiz per account a
// day, three days and a week after it went out (its postiz/postViews.ts) and
// keeps the latest reading on the post. From those:
//
//   - the month: every post that went out this calendar month, each
//     account's latest reading, added up;
//   - the last 24 hours, per account: the views its posts got in their first
//     24 hours, for the posts that went out between 24 and 48 hours ago. A
//     post younger than that has not been read yet, and one older has been
//     read again later, so that window is the one whose number IS its first
//     day.
//
// And one flag per account, the lowest of his three lines it is under:
// "In the past 24 hours, we had less than 200 views for this account."

export interface CutterViewsPost {
  id: string
  postedAt: string
  accounts: { name: string; platform: string; profile: string }[]
  /** By account name, as the cutter last read them. */
  views: Record<string, number | null | undefined>
}

export interface AccountDay {
  key: string
  platform: string
  label: string
  /** First-24-hours views of its posts from 24 to 48 hours ago; null when
   *  none of them has been read. */
  last24: number | null
  /** How many of its posts went out in that window. */
  posts: number
}

export interface CampaignViews {
  monthViews: number
  monthPosts: number
  /** Posts this month the cutter has not read yet. */
  monthUnread: number
  accounts: AccountDay[]
}

/** His lines, lowest first: an account is flagged with the lowest it is under. */
export const VIEW_FLAGS = [100, 200, 500] as const

export function viewFlag(views: number | null): (typeof VIEW_FLAGS)[number] | null {
  if (views === null) return null
  return VIEW_FLAGS.find((line) => views < line) ?? null
}

const HOUR = 3_600_000

function monthStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/** Where to read from: the start of the month, or 48 hours back if that is
 *  earlier - early in a month the last-24-hours window is last month's. */
export function readSince(now: Date): string {
  return new Date(Math.min(monthStart(now), now.getTime() - 48 * HOUR)).toISOString()
}

export function summariseViews(posts: readonly CutterViewsPost[], now: Date = new Date()): CampaignViews {
  const start = monthStart(now)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  let monthViews = 0
  let monthPosts = 0
  let monthUnread = 0
  const accounts = new Map<string, AccountDay>()

  for (const post of posts) {
    const at = Date.parse(post.postedAt)
    if (!Number.isFinite(at)) continue
    const age = now.getTime() - at

    for (const account of post.accounts) {
      const key = `${account.platform}|${account.name}`
      if (!accounts.has(key)) {
        accounts.set(key, {
          key,
          platform: account.platform,
          label: account.profile ? `@${account.profile.replace(/^@/, '')}` : account.name,
          last24: null,
          posts: 0,
        })
      }
    }

    if (at >= start && at < end) {
      monthPosts++
      const read = post.accounts.map((a) => post.views[a.name]).filter((v): v is number => typeof v === 'number')
      if (read.length === 0) monthUnread++
      monthViews += read.reduce((sum, v) => sum + v, 0)
    }

    if (age >= 24 * HOUR && age < 48 * HOUR) {
      for (const account of post.accounts) {
        const day = accounts.get(`${account.platform}|${account.name}`)!
        day.posts++
        const v = post.views[account.name]
        if (typeof v === 'number') day.last24 = (day.last24 ?? 0) + v
      }
    }
  }

  return {
    monthViews,
    monthPosts,
    monthUnread,
    accounts: [...accounts.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.label.localeCompare(b.label)),
  }
}

/** The cutter campaign a planner campaign's views come from: the one it was
 *  linked to, else one with the same name, ignoring case and punctuation. */
export function cutterCampaignFor(
  campaign: { name: string; cutter_campaign_id: string | null },
  cutterCampaigns: readonly { id: string; name: string }[],
): string | null {
  if (campaign.cutter_campaign_id) return campaign.cutter_campaign_id
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return cutterCampaigns.find((c) => plain(c.name) === plain(campaign.name))?.id ?? null
}
