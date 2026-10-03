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

## Safety properties

- Only cutter posts with status `posted` count. Scheduled is not posted.
- A repost of an earlier video (`repost_of` set) is never returned, so one deliverable is
  not paid twice.
- Idempotent across devices: each tick stores the platform link (or `cutter:<post id>:<platform>`)
  in `video_posts.url`; a post whose url is already there is skipped.
- Only accounts of the linked campaign whose platform matches are ticked. Nothing is guessed
  from a name.

## To switch it on

```
npx supabase secrets set CUTTER_BRIDGE_USER_IDS=0cd83d67-c455-46bf-8fa8-8075fa5148c1 --project-ref uykuoibqdxmpbbrsmyad
```

(That id is the zziadissa117@gmail.com account. Add more ids separated by commas.)
With the secret unset the bridge is off for everyone.

## Deployed notes

`cutter-posted` was deployed through the Supabase tooling with a trimmed copy of
`_shared/claude.ts` (session check, CORS, service client only). Deploying it from the CLI
uses the full file; both behave the same for this function.
