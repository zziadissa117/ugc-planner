# SPEC - UGC production planner

> **Read this first.** Sections 2, 4, 5 and 8 described an app that chose the
> work for him. He asked for the opposite, and the app was rebuilt around a
> target and a scoreboard - see CLAUDE.md, "What this is". Those sections are
> corrected in place and each says what changed and why. Sections 1, 3, 7 and
> 9-13 still hold.

The product specification. `CLAUDE.md` covers stack and process; this covers
what the thing does. `schema.sql` is the authoritative data shape.

---

## 1. The user and the constraint

One creator, running several brand UGC campaigns at once. Each campaign has its
own quota, pay rate, filming setup, approval route and rules. He has a day job
and works in a window after it. He uses a PC and a MacBook, and films and posts
from a phone.

He does **not** film, edit and post a video in one sitting. He batches:

- films roughly 7 videos in a session
- edits them on a different day
- posts one per day

A video is therefore an object moving through a pipeline across days, and an
evening is a pass over **one stage** of that pipeline. Everything below follows
from that.

Because posting is the daily obligation and filming and editing are supply, the
binding constraint is usually edit throughput, not filming.

---

## 2. Sessions

The first question on the landing screen is which kind of session this is:

```
FILM   |   EDIT   |   POST   |   WARM-UP
```

- **FILM** - create new videos. Setup batching matters most here.
- **EDIT** - work the filmed-but-unedited backlog.
- **POST** - submit approved videos, post what is cleared, tick off what is done.
  Usually short.
- **WARM-UP** - niche content with no brand mention at all, for campaigns still
  in warm-up. Never counts toward a paid quota, never gets a brand script,
  brand hashtag or submission step.

The second question is how long: 30 / 60 / 90 / 120 minutes plus a free-type box.

**Then which campaign, and how many.** FILM and EDIT ask for a campaign and a
goal - a number of videos - and open a console against them. This reverses what
this section originally said; see section 8.

**WARM-UP is not a filming session.** It lists the accounts set `new` or
`warming`, shows one at a time with its platform, handle and a countdown, and
records a completed session. Two of them promote the account to `ready`, and it
leaves the list. It creates no videos.

**Runway** is the number of days of posting already banked - videos sitting in
`approved`, unposted. Show it as one small line. If runway is under 3 days and
the edit backlog is non-empty, nudge toward an EDIT session with a single line
of text. Not a modal.

---

## 3. Data model

A **task is one video**, not a campaign. A campaign with a quota of 2 produces
two independent tasks, so video 1 can be ticked off while video 2 is still
outstanding. Never a per-campaign counter.

One piece of content posted to two platforms is **one** video. This is
contractual for Inflow.

Phase chains, decided by the campaign's `approval_mode`:

```
none:              to_film -> filmed -> edited -> posted
video:             to_film -> filmed -> edited -> submitted -> approved -> posted
script_and_video:  awaiting_script_approval -> to_film -> ... -> approved -> posted
brand_scripted:    awaiting_brief -> to_film -> filmed -> edited -> submitted -> posted
warm-up video:     to_film -> filmed -> edited -> posted   (never submits)
```

`blocked_reason` is orthogonal to phase. A missing handle blocks posting, not
filming - model what each missing thing actually blocks, and never let a missing
detail hide work that could be done right now.

The daily **posting quota** resets at midnight. Videos mid-pipeline do not: a
filmed video does not evaporate because the date changed. History never resets.

---

## 4. Screen: NOW (landing)

Almost nothing on it, in this order:

1. Current time, large.
2. Today's date and `X of Y posted`.
3. One small line: `N days of posts banked`.
4. Session type row.
5. `How long tonight?`
6. A button: `Already posted some? Tick them off`.

Once a session type and length are chosen:

```
3 of 9                              $175 . ~1h 12m left
[####------------------------------------]

(v) CAMPAIGN A          posted                    $35
(v) CAMPAIGN A  2/2     posted                    $35
( ) CAMPAIGN B          do this one               $35
( ) CAMPAIGN C          face to camera            $25
( ) CAMPAIGN D          waiting on their approval $35

[ START - CAMPAIGN B ]
```

Tapping any row advances that video one phase. Tap again to undo. One tap, big
target - this is the most important interaction in the app.

Done rows **stay in the list, in place, and turn green**. Never remove them: he
needs to see what he has done, and rows that vanish shift the ones below out
from under his thumb mid-tap.

---

## 5. Screen: SHOOT - superseded by the console

> The console (`src/screens/Console.tsx`) is the main screen for FILM and EDIT
> now: everything visible at once, because he works on a laptop with the phone
> as the camera. SHOOT survives for when he wants a full script in large type
> and nothing else. What this section rules out - phase diagrams, difficulty
> ratings, take counters, statistics - still applies to both.

## 5a. Screen: SHOOT

One video at a time, stripped to almost nothing:

```
CAMPAIGN NAME                                     $35
- - - o - - - - -                    (progress dots)

[ the script, large and readable, or a paste box ]

[        FILMED IT        ]

[read brief] [copy for chatgpt] [skip] [stop]
```

No phase diagrams, no difficulty ratings, no statistics, no take counters. The
script is the most readable text on the screen - he reads it off a phone propped
next to a camera.

He writes scripts elsewhere. Give a paste box per video that saves what he puts
in and shows it teleprompter-style once saved.

In an EDIT session the button reads `EDITED IT`; in POST, `POSTED IT`.

---

## 6. Screen: tick-off list

Reached from NOW without picking a session type or window. Every video owed
today, sorted alphabetically by campaign, each tappable to mark posted. Must not
require planning anything first.

---

## 7. Screen: campaigns and the drop box

A list of campaigns, each opening a brief page: what it is, how it is filmed,
what it pays, approval route, the structure, the angles, and the never-do list
in red. Each brief page has a `copy brief for ChatGPT` button producing one
clean paste-ready block - product, hard rules, structure, voice guide.

`+ New campaign` opens the drop box: two inputs, `BRIEF (.md)` and
`CONTRACT (.md)`. Each accepts a dropped file, **tap-to-pick-file** (phones do
not really drag-and-drop - this matters more than the drop target), pasted text,
or pasted JSON matching the campaign schema.

Store the raw text of both documents permanently.

### Parsing confidence is asymmetric

Contracts come from SideShift and are templated - the same headings recur every
time. Parse with high confidence:

| Field | Anchor |
|---|---|
| Pay per video | `Per-post compensation:` then `$NN.NN per approved deliverable` |
| Bonuses | under `Bonuses (per Deliverable):`, lines of `N views: $NN.NN` |
| Bonus view window | `Only views accrued within NN days` |
| Payment cycle size | `A payment cycle completes when NN deliverables` |
| Base comp cap | `maximum of NN posts per payment cycle` |
| Platforms | `Required platforms:` |
| Campaign name, company, term start | Key Contract Information table |
| Days a post must stay public | `not delete, hide, or restrict it for a period of NN` |

Briefs have no fixed format. Attempt only: platforms, video length and aspect
ratio, approval route, disclosure requirements, and hashtag tokens.

### The parser runs server-side

A Supabase Edge Function calls the model API, so the key is a server secret and
never reaches the browser. Request structured JSON against a strict schema, with
instructions to return `null` for anything absent and never to infer.

**Every extracted field must come back with a `source_quote`** - the exact
substring it came from. The function then checks that quote actually appears in
the uploaded text and blanks any field where it does not. This catches
fabrication mechanically instead of trusting the model to behave.

Not yet deployed. Stub it behind an interface; make the paste-JSON path work now.

### The review screen

Every parsed field renders `FROM FILE - unreviewed` in amber until confirmed
with a tap. Everything not found is blank and marked `not saved yet`. Nothing
counts as a documented rate or verified quota until confirmed.

Fields no document ever contains - **handles, setup type, real per-stage times,
daily quota** - are left blank with no attempt to infer. Say so on the review
screen in one plain line, so "it did not fill that in" reads as expected
behaviour rather than a bug.

### Damaged files

These markdown files are PDF conversions. They lose section headings, scramble
tables, and carry OCR garbage. Do not crash, and do not treat a missing section
as an absent rule. If section numbers are non-sequential, or a cross-reference
points at a section that is not present, set `brief_is_incomplete` and show:
`This brief looks incomplete. Some rules may be missing.`

---

## 8. The fitting algorithm - now optional

> This is no longer the default path. It runs behind "Or plan it for me" on the
> campaign picker, unchanged, for the evenings he does not want to choose. The
> rule below that "he never picks a count" is the one thing here he explicitly
> reversed: the console asks for a goal, because he asked it to.
>
> One correction that applies wherever the algorithm still runs: a campaign
> with no `default_setup` used to be dropped silently, because `stageMinutes`
> returned null and nothing surfaced it. There is now a setup picker on the
> brief page, which is what makes a campaign he added plannable at all.

## 8a. The fitting algorithm, as it still works

Runs **within the chosen session type**. A FILM session only considers videos
needing filming.

1. Score every eligible task. Weight roughly in this order: contracted work owed
   today, approval-gated work (needs lead time, so it front-loads), pay per
   video, pay per minute of production time, staying in the setup already in
   use, bonus upside.
2. **Pack contracted work first, on its own pass.** Fill leftover time with
   no-quota work only. On a short evening not everything clears, so optional
   work must never take a slot a paid video could have used.
3. Group by setup, order groups to minimise switches. Charge
   `user_settings.setup_switch_minutes` per switch and let that cost outweigh a
   small gain in value.
4. Time a task by its **remaining work in this session's stage only**, not the
   whole pipeline.
5. In a POST session, prioritise anything at risk: aging approved videos, and
   the day's quota.
6. **In a FILM or WARM-UP session, spend leftover time generating new supply.**
   Today's already-owed rows are packed first, as above. Whatever session time
   is left is then filled with *new* videos, created in priority order until the
   window runs out.

   He batches - roughly 7 videos a session - so a FILM session that could only
   ever offer the one video owed today would be useless. New rows are created
   with `owed_for_date = null`, which is what the schema means by supply built
   ahead of demand: they are stock, not an obligation for any particular day.
   Phase is the start of the campaign's chain, and `video_kind` follows the
   campaign - `warm_up` in a WARM-UP session, `contracted` for a campaign with a
   daily quota, `no_quota` otherwise.

   **He never picks a count.** The algorithm fills the window: it keeps adding
   supply, in the same setup-batched priority order as everything else and
   charging the same switch cost, until the next video would not fit. Asking
   "how many tonight?" would be one more thing to decide, and removing the
   deciding is the entire point of the app.

Keep the weights in one clearly named exported object with a comment per weight.

---

## 9. Time estimates

Per-setup starting estimates in minutes (film / edit / post), labelled **EST**:

```
face    12 / 15 / 5
screen   8 / 12 / 5
phone   10 / 12 / 5
notalk   8 / 18 / 5
```

Setup switch cost: 10 minutes. All editable.

Derive **MEASURED** values from `phase_events` once there are 2+ samples for a
campaign at a stage. Never present an estimate as a measurement.

---

## 10. Money - pay by day, week, month

> This used to be three figures (base earned, expected bonus, paid bonus)
> plus cycle progress and a first-run opening balance. In real use that read
> as a ledger he had to maintain rather than a reason to keep going, and the
> cycle/opening-balance machinery was the part he said was "useless noise." He
> asked directly for the opposite: "just track how much it pays by day, week,
> month to motivate me." `src/money.ts` still computes the old three-figure,
> never-summed breakdown (`summariseCampaignMoney`) for the one thing that
> still needs it - flagging a posted video with no rate snapshot, which stays
> a count, never a zero - but the screen no longer shows cycle position,
> opening balance or "accrued" language.

- **Today / this week / this month** - posted videos times
  `rate_snapshot_cents`, bucketed by `posted_at` into the current calendar day,
  the current calendar week (Monday start) and the current calendar month.
  Shown per campaign and as a total across all of them.
- **CAD conversion** - each figure also shows an approximate CAD amount,
  clearly labelled `~$X CAD`, converted with a fixed constant
  (`USD_TO_CAD_RATE` in `src/money.ts`) rather than a live rate: the app is
  local-first and works fully offline, so nothing on this screen fetches
  anything. It is an estimate, and is never presented as exact.
- **Unpriced posted videos** are still flagged rather than counted as zero,
  with the same backfill action as before once a rate exists to apply.

---

## 11. Campaign seed: Inflow

From the user's real brief and signed contract. Load as a confirmed campaign.

### Identity

- Display name **Inflow**; contract name `Inflow UGC - Finance & Fintech`;
  company Inflowpay
- Term commenced August 17 2026, effective August 18 2026
- Platforms: TikTok + Instagram, his own accounts, never a brand page
- Handles: **@michael.financier** on both
- Setup: `face` default, per-video override to `screen` for fee-breakdown and
  dashboard videos

### Quota, cycle, pay

- **1 posted video per day**
- Same content on both platforms counts as **one** deliverable
- **60 posts per payment cycle**; base compensation capped at 60 per cycle
- **Opening balance: 13 posts** (user-entered, carried over)
- **$35.00** per approved and posted deliverable
- Bonus **$50** at 50,000 views, **$100** at 100,000 views; each milestone once
  per deliverable; only views within **30 days** of upload count
- Paid after every 60 posts delivered

### Approval

`approval_mode = video`. Submit each video on **SideShift** before posting, or in
the WhatsApp group. One round of revisions per video.

Submission URL: **not saved yet.** The documents give only `support@sideshift.app`,
which is a dispute contact, not a submission link. Do not put it in that field.

### Warm-up

First 3 to 5 videos in his usual niche - money, business, entrepreneurship,
payments - with **no mention of Inflow at all**. A brand-new account does one
week of normal daily use before warm-up starts.

### Angles - two sources disagree, do not merge them

The **brief** documents six. Load these as verified:

- **A. Frozen funds** (strongest, FEAR) - a good month looks like fraud to an
  algorithm; accounts freeze exactly when a business takes off.
- **B. Waiting for your own money** (FEAR) - the sale clears in 3 seconds, the
  payout takes 7 days.
- **C. Your country is not supported** (FEAR) - rejected for a passport or
  address, not a business.
- **D. Taxes handled** (FEAR) - selling in 10 countries means obligations in 10
  countries; Inflow is the official seller and files them.
- **E. The real rate** (GREED) - advertised 2.5-2.9% becomes well past 4% once
  international cards, currency conversion and chargebacks stack.
- **F. You use it too** (GREED) - speak as an actual user, not as an ad.

The brief splits these into FEAR (A-D) and GREED (E-F) and notes a good account
alternates between families. Track which family was used last.

A separate skill file the user maintains lists **eight** angles, adding "Nobody
picks up" and "Switching is not a project". Those appear in the brief only as
product context, never as named angles. Load them with `is_verified = false` and
display them separately. **Never produce a merged list of eight.**

One angle per video. Never mix storylines.

### Structure

Hook (0-2 sec) -> the problem / "that's me" moment -> Inflow introduced naturally
as what fixed it -> payoff with a concrete number or visual -> simple ending.

### Never-do list (red)

- Never promise anyone escapes, avoids or hides from taxes. "Escape" applies to
  fees, freezes and waiting, never to taxes.
- Never name or attack a competitor. Say "your payment processor" or "most
  processors".
- Never mix more than one angle into a video.
- Never say "Inflow" more than once, and never during warm-up.
- No filters or built-in camera effects. No fancy fonts or motion on captions -
  default CapCut captions, white bold, one headline.
- No zoom, no shaky footage.
- Every Inflow video carries **#ad** (or the platform's paid partnership label)
  and tags **@inflowpay**.
- Keep every approved post public for **90 days**. Early removal forfeits bonus
  money and can reduce base pay.
- No volume padding: no reposting the same or substantially the same video, no
  high-volume bursts to hit cadence.
- Numbers exactly as written: **4% + $0.35**, instant payouts.

### Technical

9:16 vertical, 1080x1920, 30 FPS, HDR off. iPhone 12 or newer. Steady, no zoom.
Back camera when someone else holds the phone, front camera fine for talking
head. Natural or good light, no backlighting. Clear audio. If showing fees or a
dashboard, the number must be readable full-frame for at least 2 seconds.
Minimum 15 seconds - length is not the goal, attention is.

### Product facts (brief page and ChatGPT block)

Inflow is a payment system for people who sell online: paid instantly, from
anywhere, at one flat price of 4% + $0.35 all inclusive, with sales taxes
collected and filed because Inflow is the official seller on the transaction. No
country restrictions. Real humans 7 days a week. One-click integration.

Audience: online store owners 25-45 selling internationally and running ads;
creators and digital sellers; people running a business while living abroad.
They scroll past anything that smells like an ad.

Tone: talk like a person telling a friend something useful. Concrete over
clever. Annoyed, surprised or relieved is good; flat delivery kills the video.

### This brief is damaged

The source markdown is a lossy PDF conversion. Sections 5, 6 and 7 headings are
missing, section 4 cross-references a section 6 whose text is absent, and there
are OCR garbage blocks where screenshots were. Set `brief_is_incomplete = true`.
The never-do list above is assembled from what survived and may be incomplete.

---

## 12. Ship these blank - do not fill them in

Each renders `not saved yet` and blocks only what it actually blocks.

1. **Filmed-but-unedited backlog count.** The user says more than 7. Ship a
   first-run field. Do not seed a guess - the runway figure depends on it.
2. **SideShift submission URL.**
3. **Real film / edit / post minutes.** Start at EST, measure from use.
   *Now possible:* the console stamps `phase_events.work_session_id` and real
   durations, so measured timings finally have data behind them.
4. **Trial period status.** The brief sets a 15-day trial from the first Inflow
   post, reviewed at day 15. That date is in neither document. Ship a field; if
   filled, show days remaining.
5. **Whether wider-topic videos count as paid deliverables.** The brief asks for
   roughly 1 Inflow video per 2 wider-topic videos; the contract pays per
   approved deliverable without defining whether a non-brand video qualifies.
   Track both counts separately via `video_kind`. Do not assume. Surface the
   open question on the brief page.
6. **All bonus probabilities.** Default zero.

---

## 13. Also required

- Export and import of all state as JSON, in a textarea with a copy button.
  Browsers block downloads in some contexts and this is the backup of record.
- Prompt for an export if `last_export_at` is more than 7 days ago.
- Resets (today only / everything) behind a two-tap confirmation. "Everything"
  must warn that the ledger and opening balance go with it.