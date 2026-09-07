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

## 2. Sessions - almost none left

> Rewritten. This section used to open with a four-way session chooser (FILM /
> EDIT / POST / WARM-UP), a window length, and a planner that packed an
> evening. All of it is gone: he asked for a target and a scoreboard, and each
> of those was a decision standing between him and the camera.

There are two things the app asks him to start, and one of them is optional:

- **FILM** - pick a campaign, set a goal (a number of videos), work the
  console. No window length, no clock. The console shows the campaign summary,
  the hooks he generates or dumped, the can-say/never-do columns and a counter.
- **WARM-UP** - only when an account is set `new` or `warming`. Shows one
  account with its platform, handle and a fixed countdown, and records a
  completed session. Two promote it to `ready` and it leaves the list. It
  creates no videos.

**Editing is not a session.** A filmed video becomes edited with one tap on the
home screen (`N filmed, ready to edit` + `Mark edited`), oldest first. No goal,
no timer, no campaign picker.

**Posting is not a session either.** It has its own permanent tab, and is
described in section 6.

**Runway** is the number of days of posting already banked - videos sitting at
`edited`, unposted. One small line on the home screen, nothing more. The old
"nudge toward an EDIT session" line is gone: a sentence with no action attached
to it is noise.

---

## 3. Data model

A **task is one video**, not a campaign. A campaign with a quota of 2 produces
two independent tasks, so video 1 can be ticked off while video 2 is still
outstanding. Never a per-campaign counter.

One piece of content posted to two platforms is **one** video. This is
contractual for Inflow.

**How many a day is a fact about the campaign, not about its accounts.**
`campaigns.daily_post_quota` is the only source, and platforms are where a
deliverable goes. Reading demand off the account list made three platforms
mean three deliverables, three obligations and three payments.

One phase chain, for every campaign and kind:

```
to_film -> filmed -> edited -> posted
```

`approval_mode` still records what the contract requires and no longer decides
anything: a brand's approval happens in SideShift and WhatsApp, and the app is
never told. The `video_phase` enum keeps its retired values because Postgres
cannot drop one without rewriting the append-only history.

**A video reaches `posted` the moment it goes out on its first platform**, and
comes back out only when its last `video_post` is removed.

`blocked_reason` is orthogonal to phase. A missing handle blocks posting, not
filming - model what each missing thing actually blocks, and never let a missing
detail hide work that could be done right now.

The daily **posting quota** resets at midnight. Videos mid-pipeline do not: a
filmed video does not evaporate because the date changed. History never resets.

---

## 4. Screen: NOW (landing)

Almost nothing on it, in this order:

1. Current time, large, with today's date under it.
2. `X of Y posted today` on the right, plus `Nd banked`.
   - **X counts deliverables that actually went out today** - videos with a
     `video_post` dated today, de-duplicated by video. It used to count phase
     changes, which is how a backlog cleared in one sitting produced
     "19 of 6 posted".
   - **Y is the sum of `daily_post_quota` across campaigns.** Never derived
     from how many platforms a campaign posts to.
3. `N filmed, ready to edit` and a `Mark edited` button, only when there is a
   backlog.
4. Two buttons: `FILM` and `POST`.
5. `Warm up N accounts`, only when something is set `new` or `warming`.

---

## 5. Screen: SHOOT - removed

The teleprompter is gone, along with `src/chatgpt.ts` and the script-paste box.
"Remove the Plan feature completely. I don't understand the workflow and it
does not make sense for how I work." Do not rebuild it.

---

## 6. Screen: POST

A permanent tab, and the only place in the app that can say something was
posted. Per campaign:

```
Inflow                                        1 of 1 today · $35.00 each
  TikTok     @michael.financier               [x]  [+]
  Instagram  @michael.financier               [ ]  [+]
  YouTube    michael.financier                [ ]  [+]
```

- **Rows are accounts, columns are deliverables owed today.** A campaign owing
  one post a day across three platforms is one campaign, three rows, one box
  each. Not three campaigns, and not three payments.
- **Each box is independent.** Ticking one never changes, hides or reorders
  another.
- **A column is one deliverable.** Ticking three platforms in the same column
  writes three `video_posts` against the same video, which is earned once. It
  is posted from the first tick and un-earned only when the last one is
  removed.
- **Nothing is gated on filming.** A tick with no video behind it takes the
  oldest unposted stock, or creates a row. There is no state in which the
  screen refuses.
- **`+` adds an extra deliverable** beyond the quota, so over-delivering is
  representable rather than impossible.
- **It clears at midnight by construction**: a box is checked when a post for
  that account is dated today, so nothing has to run to reset it.
- Accounts still `new` or `warming` are shown with a small tag, not hidden.
  Warm-up is a caution, never a block on recording what he did.

---

## 7. Screen: campaigns and the drop box

A list of campaigns, each showing its platforms and what it pays a day, and
each opening a brief page.

### The brief page

Rewritten to hold only what answers a question he has while making a video.
"If this information does not directly help me understand what video to make,
what hook to use, what platform to post on, or what the campaign requires,
remove it from the main UI."

Two columns on anything wider than a phone, because he reads it on a laptop:

- **The strip**: `$ per post`, `posts/day`, and what that pays a day. All three
  editable in place; the rate goes through the field row so provenance and the
  campaign column move together.
- **The brief**: exactly four fields - `product_facts`, `audience`, `tone`,
  `structure`, labelled in plain words. Amber until confirmed, as always.
- **Hooks & ideas**: folded by default, deletable one by one, and a box he
  dumps hooks, video ideas, formats and concepts into (blank line between
  entries). This is the material hook generation builds from.
- **Platforms**: one row per account - platform, handle, email, password on a
  single line, with the add controls collapsed behind `Add`.
- **Never do**: folded.
- **Everything else from the documents**: one folded line holding every other
  parsed field, still editable. Trial dates, aspect ratios, wider-topic ratios,
  warm-up prep, angle-family notes and the rest live here and nowhere else.

Gone from this page: the angles section and its editor (angles are optional
context, and nothing asks him to write one), `editing_style`, the default-setup
picker, the campaign-level login box, the legacy `platforms`/`handle_tiktok`/
`handle_instagram` fields, and the ChatGPT copy block.

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

## 8. The fitting algorithm - removed

Deleted with the planner (`src/fitting`, `src/session`). Nothing schedules an
evening any more; he picks a campaign and a goal.

---

## 9. Time estimates - unused

The `time_estimates` table and its defaults still exist and still sync; nothing
reads them since the planner was removed. Left in place rather than dropped:
removing a table is a migration and ten files, and an unread table costs
nothing. Do not build anything new on it.

---

## 10. Money - rate x posts per day

> Rewritten twice, both times because the screen showed a number that was not
> true. First it was a three-figure ledger with cycle progress and an opening
> balance - "too much noise". Then it summed what had actually been posted per
> period, and a backlog cleared in one sitting read as **$455 earned today**.
> A campaign paying $35 for one post a day across three platforms had also read
> as **$105/day** while demand was derived from the account list.

One formula, and nothing else on the screen:

```
day   = pay_per_video_cents x daily_post_quota
week  = day x 7
month = day x 30
```

- **Nothing here counts videos, posts or platforms.** There is no path by
  which a duplicated row, an extra platform or a busy afternoon can change what
  a day is worth. `src/money.ts` reads two columns off the campaign row.
- **A campaign with no rate is left out and named**, never counted as zero: its
  pay is unknown, not nothing.
- **CAD conversion** - each figure also shows an approximate CAD amount,
  labelled `~$X CAD`, converted with a fixed constant (`USD_TO_CAD_RATE`)
  rather than a live rate: the app is local-first and works fully offline, so
  nothing on this screen fetches anything. It is an estimate and is never
  presented as exact.
- Week and month are seven and thirty days of the same rate - what the work
  pays at his current quotas, not a ledger of a particular calendar month.

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