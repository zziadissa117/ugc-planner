# The planner's own server functions

The planner is shared with other people, but some of what it can do is his
alone: reading PDFs (costly), anything that reaches into the cutter (private),
and anything that talks to his Postiz. Those live in Edge Functions that all
answer to one owner gate, so later features plug into the same shape instead
of each inventing an allow-list.

## The owner gate

`supabase/functions/_shared/owner.ts`:

- `PLANNER_ADMIN_USER_IDS` - comma-separated auth user ids. The owner list.
- Until it is set, `CUTTER_BRIDGE_USER_IDS` stands in (it already lists his
  ids for `cutter-posted`), so nothing has to be set to start.
- `isOwner(userId)` with the id from `requireUser` - the verified session,
  never the request body.

A function that is owner-only answers anyone else in one of two ways:

- **Quietly**, when the feature should simply not exist for them:
  `{ enabled: false }` with 200, and the browser shows nothing
  (`cutter-posted`, `planner-postiz`).
- **Refused in words**, when they could reach the action by accident or
  design and should know why: 403 with a sentence
  (`parse-campaign` `transcribe`: "PDF reading is only on for the owner
  account. Paste Markdown instead.").

The browser may ask first (`parse-campaign` `capabilities` -> `{ pdf }`) so it
only offers what will work, but the server checks again on every call.

## Talking to the cutter

The cutter (`silence-cutter`, its own repo) is in the same Supabase project.
Its tables are server-only and its Postiz keys are sealed with a key derived
from the project's service key. Two ways in, by what is needed:

- **Reading cutter tables** - the planner function reads them itself with the
  service role, as `cutter-posted` does with `cutter_posts`.
- **Anything needing a Postiz key** - ask the cutter's `postiz` function, which
  holds the keys and never hands one out. Server to server: POST to
  `${SUPABASE_URL}/functions/v1/postiz` with header
  `x-planner-bridge: <SUPABASE_SERVICE_ROLE_KEY>`. The cutter checks it against
  its own copy of the key. That key already seals every Postiz key there, so
  accepting it opens nothing new, and there is no second secret to set or
  rotate. Add a new action beside `channels` in the cutter's `postiz/index.ts`
  (gated by `bridgeAllowed`, like `tick` is gated by its secret) and keep the
  logic in a pure, tested module there (`postiz/channels.ts`).

The cutter's `postiz` function is deployed from the cutter repo
(`./deploy-server.sh`). Until it is, the planner's call answers "The cutter is
not updated for this yet".

## planner-postiz

```
POST { action: 'channels', cutterCampaignId } -> { enabled, profiles }
```

Which Postiz channels a campaign holds, for freeing them when it ends (his plan
counts 30). Per posting profile: `inUse` (connected channels on that Postiz
key), and each account the campaign posts to with `disabled` (`null` when Postiz
no longer has it), `alsoUsedBy` (other cutter campaigns on the same account) and
`scheduled` (posts still due on it). A profile whose key could not be read
carries `error` instead.

**Why it only guides.** Postiz's public API has no disable or enable route. The
one call that touches an account, `DELETE /integrations/{id}`, removes it for
good along with its scheduled posts - never what archiving a campaign should
do. `GET /integrations` does report `disabled` per account, so the planner shows
what to switch off, links to Postiz, and checks again afterwards
(`src/components/PostizChannels.tsx`, rules in `src/postizChannels.ts`):

- white - connected and nothing live needs it: disable it
- grey - already disabled, or "keep": a planner campaign that is not archived
  is linked to a cutter campaign that posts to the same account
- red line - posts still due on accounts about to be disabled; they would fail

Archiving a linked campaign lands on Archived with its list open
(`?free=<id>`); restoring one opens its page with the reverse list
(`?postiz=restore`). The channel limit (30) is a per-device setting in the
panel.

If Postiz ever adds a disable route, the switch belongs in the cutter's
`postiz` function as a bridge action, called from here behind the same owner
gate - and only after the same check that no live campaign uses the account.

Deploy: `source/index.ts`, `source/deno.json`, `_shared/claude.ts`,
`_shared/owner.ts`, `verify_jwt: true`.
