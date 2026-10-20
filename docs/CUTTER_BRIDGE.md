# Cutter bridge

A video the cutter app posts ticks the planner's Post grid by itself.

## How it works

1. `campaigns.cutter_campaign_id` (migration 0017, applied 2026-10-02) links a planner
   campaign to a cutter campaign. Set on the campaign page ("Posted by the cutter").
   Null means ticked by hand, which is every existing campaign.
2. Edge Function `cutter-posted` reads the cutter's `cutter_posts` with the service role.
   It answers only for user ids in the `CUTTER_BRIDGE_USER_IDS` secret (comma separated).
   Anyone else signed in gets `enabled: false`, so the people the planner is shared with
   never see cutter data, and the link picker is hidden for them.
3. `src/sync/cutterBridge.ts` runs a pass on open, on return to the tab and every 5 minutes.
   `src/data/cutterBridge.ts` turns each posted video into the same ticks as a manual tap
   (`markPosted`), so the rate snapshot, earnings history and one-deliverable-many-platforms
   rule are unchanged.

## Scheduled boxes (blue)

`cutter-posted` also answers `{ action: 'scheduled', ids }` with the linked campaigns' posts waiting in Postiz
for a time in the next two days (`status = 'scheduled'`, not reposts). The Post screen counts today's per planner
account - the account each post really goes to (`scheduledByAccount`, `accountFor` in `src/data/cutterBridge.ts`) -
and paints that many open boxes blue with a ticking
clock (`useCutterScheduled`, refreshed every 5 minutes and on return). It is display only: nothing is written, and
a box still ticks for real only when the post goes out (`posted`). He can tick a blue box by hand as before.

## Views (the views tracker)

The cutter reads each posted video's views from Postiz, per account, a day, three days and a week after it went
out (its `postiz/postViews.ts`), into `cutter_posts.views` (by account name). `posted` returns them as `views`;
reading them moves the cutter post's `updated_at`, so the next pass picks them up and `applyCutterPosts` writes each
account's number onto its tick (`setViewCount`) - also on a tick made before. A campaign with `min_views` (migration
0019) shows how many of its posted videos reached it on any one account (`src/data/viewsTracker.ts`).

## Linking: suggested, never automatic

Nothing reaches a planner campaign until it is linked (`campaigns.cutter_campaign_id`). The Post screen's "Link to
the Cutter" block (`src/components/CutterLinks.tsx`) and the brief's "Posted by the cutter" picker offer a cutter
campaign of the same name (`suggestCutterLinks`: case and punctuation ignored, a clear "starts with" only when it is
the one candidate) as one tap he confirms; "Not this" hides a pairing on that device. Cutter campaigns with no
planner campaign are not mentioned anywhere: some, like "Temporary lovable", have none on purpose, and a standing
"not here" line about them was noise he asked to remove. `scheduled` returns every campaign's posts (no `ids`); the
grid only paints linked ones.

## Safety properties

- Only cutter posts with status `posted` count. Scheduled is not posted.
- A repost of an earlier video (`repost_of` set) is never returned, so one deliverable is
  not paid twice.
- Idempotent across devices: each tick stores the video's own link (or `cutter:<post id>:<platform>`)
  in `video_posts.url`; a post whose url is already there is skipped. Only a link to the video itself
  counts (`videoLink`): Postiz gives TikTok the account's page, the same for every video, which made
  every TikTok post after the first look ticked already. Links are keyed by the account's name.
- The account ticked is the one the post went to (`accountFor`): by its handle (`profile`, sent by
  `cutter-posted` since 2026-10-19), one a letter or two off a saved handle, or - with no handle saved
  to tell them apart - the only account on that platform. Never another account on the same platform:
  matching the platform alone ticked @danny.snoozed for posts to @lockinwithziad and Jake's posts on
  @hooksandmike. An account the campaign doesn't have is named under its board instead (amber), until
  he adds it or nothing has gone there for 3 days (`lastUnmatched`, the scheduled list).
- One post is one deliverable: all its accounts are ticked in the same column - the one it already
  holds that day (found only by a tick with a url: a box ticked by hand has none, and null matching
  null once put each account of a post in a column of its own - "8 of 2 today"); else a column he
  ticked by hand on exactly its accounts before it went out (`handColumn`: he ticks the boxes as he
  sends the video - those ticks become the post's, with its link and time, in their place); else the
  first open on every account it went to; else a new one.
- A post is ticked on the day it went out, with its real time (`markPosted`'s `postedAt`): one from
  23:31 ticked the next morning used to land on the next day's board. A post found ticked on another
  day (by an earlier version) is taken off it and ticked on its own day.
- Every pass first puts right what earlier versions left: `mergeSplitPosts` joins a post spread over
  a column per account (its ticks share the post's time to the millisecond), `joinHandColumns` joins a
  post and the hand column ticked for it (same rule as `handColumn`, last 7 days). The fortnight is
  read once more from the start when `REREAD` in `src/sync/cutterBridge.ts` changes, so posts ticked
  on the wrong day come by again.
- A pass that gets a full page (200) goes on from the last one's `updatedAt` instead of from now.

## To switch it on

```
npx supabase secrets set CUTTER_BRIDGE_USER_IDS=00cf1d16-ffb1-4bb8-b3d8-2882f52e8c9c --project-ref uykuoibqdxmpbbrsmyad
```

(That id is ugcacc1ziad@gmail.com - the planner account his campaigns are in, and the only one he wants to see
cutter posts. It was first set to zziadissa117@gmail.com, which has no campaigns, and so the bridge stayed silent
for the account he actually uses. Add more ids separated by commas. The PDF owner gate falls back to this list
while `PLANNER_ADMIN_USER_IDS` is unset.)
With the secret unset the bridge is off for everyone.

## Deployed notes

`cutter-posted` was deployed through the Supabase tooling with a trimmed copy of
`_shared/claude.ts` (session check, CORS, service client only). Deploying it from the CLI
uses the full file; both behave the same for this function.
