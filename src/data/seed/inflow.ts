// The Inflow campaign, from SPEC section 11.
//
// ---------------------------------------------------------------------------
// Why nothing here is `documented`
// ---------------------------------------------------------------------------
//
// `documented` is a claim that a value can be pointed at in a real document.
// The schema enforces that literally: documented_needs_proof requires a
// source_quote, and the parser contract requires that quote to be checked as
// an exact substring of stored document text before it is trusted.
//
// The real brief and the signed contract are not in this repository. SPEC.md
// describes what they say, but a description is not a quote, and SPEC.md is
// not the document - it is the user telling us what he read there. So every
// value below is `user_entered`: it came from the user, which is true, rather
// than from a document we can produce on demand, which is not.
//
// This is not a gap to be filled in by writing better-sounding quotes. When
// the real .md files are dropped in through the phase 8 drop box, their raw
// text is stored, the parser quotes them, and the review screen promotes these
// fields to `documented` one confirmed tap at a time. Until then the brief
// page will say these came from him, and that is the honest state.
//
// Nothing is `parsed_unreviewed` either: no parser has run. That state means
// "a model extracted this and no human has checked it", and claiming it here
// would invent a review step that never happened.

import type { DocumentKind, FieldSource, SetupType } from '../schema'

/** Fixed ids so seeding twice is a no-op rather than a duplicate. */
export const INFLOW_CAMPAIGN_ID = '1f10c0de-0000-4000-8000-000000000001'

export const INFLOW_CAMPAIGN = {
  id: INFLOW_CAMPAIGN_ID,
  name: 'Inflow',
  company: 'Inflowpay',
  approval_mode: 'video' as const,
  default_setup: 'face' as SetupType,
  /** One posted video per day. */
  daily_post_quota: 1,
  /** $35.00 per approved and posted deliverable, in integer cents. */
  pay_per_video_cents: 3500,
  /** 60 posts per payment cycle; base compensation capped at 60 per cycle. */
  cycle_size: 60,
  /** Posts made before this app existed. User-entered, carried over. */
  opening_post_count: 13,
  /** The source markdown is a lossy PDF conversion: sections 5, 6 and 7 have
   *  lost their headings, section 4 cross-references a section 6 whose text is
   *  absent, and there are OCR garbage blocks where screenshots were. */
  brief_is_incomplete: true,
}

interface SeedField {
  field_key: string
  field_value: string | null
  source: FieldSource
  /** Why this field has the source it has. Not stored - it is here so the next
   *  person to read this file does not have to reconstruct the reasoning. */
  note?: string
}

export const INFLOW_FIELDS: readonly SeedField[] = [
  // --- Identity ----------------------------------------------------------
  { field_key: 'contract_name', field_value: 'Inflow UGC - Finance & Fintech', source: 'user_entered' },
  { field_key: 'term_commenced', field_value: '2026-08-17', source: 'user_entered' },
  { field_key: 'term_effective', field_value: '2026-08-18', source: 'user_entered' },
  { field_key: 'platforms', field_value: 'TikTok, Instagram', source: 'user_entered' },
  {
    field_key: 'account_ownership',
    field_value: 'His own accounts. Never a brand page.',
    source: 'user_entered',
  },
  { field_key: 'handle_tiktok', field_value: '@michael.financier', source: 'user_entered' },
  { field_key: 'handle_instagram', field_value: '@michael.financier', source: 'user_entered' },
  {
    field_key: 'setup_override_rule',
    field_value: 'face by default; screen for fee-breakdown and dashboard videos',
    source: 'user_entered',
  },

  // --- Quota, cycle, pay -------------------------------------------------
  {
    field_key: 'cross_platform_counts_as_one',
    field_value: 'Yes - the same content on TikTok and Instagram is one deliverable.',
    source: 'user_entered',
  },
  {
    field_key: 'base_comp_cap',
    field_value: 'Base compensation capped at 60 posts per payment cycle.',
    source: 'user_entered',
  },
  {
    field_key: 'payment_trigger',
    field_value: 'Paid after every 60 posts delivered. A cycle must complete before anything is payable.',
    source: 'user_entered',
  },

  // --- Approval ----------------------------------------------------------
  {
    field_key: 'submission_route',
    field_value: 'Submit each video on SideShift before posting, or in the WhatsApp group.',
    source: 'user_entered',
  },
  { field_key: 'revision_rounds', field_value: '1', source: 'user_entered' },
  {
    // SPEC section 12.2. The documents give only support@sideshift.app, which
    // is a dispute contact, not a submission link. Putting it here would be a
    // plausible-looking wrong answer, which is worse than a blank.
    field_key: 'submission_url',
    field_value: null,
    source: 'missing',
    note: 'SPEC 12.2 - ship this blank. support@sideshift.app is a dispute contact, not a submission link.',
  },

  // --- Warm-up -----------------------------------------------------------
  {
    field_key: 'warm_up_plan',
    field_value:
      'First 3 to 5 videos in his usual niche - money, business, entrepreneurship, payments - with no mention of Inflow at all.',
    source: 'user_entered',
  },
  {
    field_key: 'warm_up_account_prep',
    field_value: 'A brand-new account does one week of normal daily use before warm-up starts.',
    source: 'user_entered',
  },

  // --- Structure and voice ----------------------------------------------
  {
    field_key: 'structure',
    field_value:
      'Hook (0-2 sec) -> the problem / "that\'s me" moment -> Inflow introduced naturally as what fixed it -> payoff with a concrete number or visual -> simple ending.',
    source: 'user_entered',
  },
  {
    field_key: 'angle_family_alternation',
    field_value: 'A good account alternates between the FEAR and GREED families.',
    source: 'user_entered',
  },
  {
    field_key: 'tone',
    field_value:
      'Talk like a person telling a friend something useful. Concrete over clever. Annoyed, surprised or relieved is good; flat delivery kills the video.',
    source: 'user_entered',
  },
  {
    field_key: 'audience',
    field_value:
      'Online store owners 25-45 selling internationally and running ads; creators and digital sellers; people running a business while living abroad. They scroll past anything that smells like an ad.',
    source: 'user_entered',
  },
  {
    field_key: 'product_facts',
    field_value:
      'Inflow is a payment system for people who sell online: paid instantly, from anywhere, at one flat price of 4% + $0.35 all inclusive, with sales taxes collected and filed because Inflow is the official seller on the transaction. No country restrictions. Real humans 7 days a week. One-click integration.',
    source: 'user_entered',
  },

  // --- Technical ---------------------------------------------------------
  {
    field_key: 'technical_spec',
    field_value:
      '9:16 vertical, 1080x1920, 30 FPS, HDR off. iPhone 12 or newer. Steady, no zoom. Back camera when someone else holds the phone, front camera fine for a talking head. Natural or good light, no backlighting. Clear audio. If showing fees or a dashboard, the number must be readable full-frame for at least 2 seconds.',
    source: 'user_entered',
  },
  {
    field_key: 'minimum_length_seconds',
    field_value: '15',
    source: 'user_entered',
  },
  {
    field_key: 'post_public_days',
    field_value: '90',
    source: 'user_entered',
  },
  {
    field_key: 'disclosure',
    field_value: 'Every Inflow video carries #ad or the platform paid partnership label, and tags @inflowpay.',
    source: 'user_entered',
  },

  // --- What the carried-over posts were paid at --------------------------
  {
    // Ships blank, and is never filled in from pay_per_video_cents.
    //
    // The 13 posts carried over happened before this app existed and no rate
    // was ever recorded for them. Today's $35.00 is a fact about today; using
    // it here would silently turn a guess into $455.00 of earnings history and
    // there would be no way to tell afterwards that nobody had checked. If he
    // confirms a rate himself, the money screen shows what those posts were
    // worth - on its own line, never folded into the per-video total.
    field_key: 'opening_balance_rate_cents',
    field_value: null,
    source: 'missing',
    note: 'Never auto-derived from the campaign rate. Only he knows what the carried-over posts paid.',
  },

  // --- Trial period. SPEC section 12.4 -----------------------------------
  {
    field_key: 'trial_length_days',
    field_value: '15',
    source: 'user_entered',
    note: 'The 15-day length is stated. The date it runs from is not - see trial_first_post_date.',
  },
  {
    field_key: 'trial_first_post_date',
    field_value: null,
    source: 'missing',
    note: 'SPEC 12.4 - the trial runs 15 days from the first Inflow post, reviewed at day 15. That date is in neither document. If filled, show days remaining.',
  },

  // --- The open question. SPEC section 12.5 ------------------------------
  {
    field_key: 'wider_topic_ratio',
    field_value: 'The brief asks for roughly 1 Inflow video per 2 wider-topic videos.',
    source: 'user_entered',
  },
  {
    field_key: 'wider_topic_counts_as_deliverable',
    field_value: null,
    source: 'missing',
    note: 'SPEC 12.5 - the contract pays per approved deliverable without defining whether a non-brand video qualifies. Do not assume. video_kind tracks both counts separately; surface the open question on the brief page.',
  },
]

// ---------------------------------------------------------------------------
// Angles - two sources disagree, and they are not merged
// ---------------------------------------------------------------------------

interface SeedAngle {
  id: string
  label: string
  body: string
  family: string | null
  is_verified: boolean
  sort_order: number
}

/** The six the brief documents. SPEC section 11 says to load these as
 *  verified: they came from the campaign's own brief. The brief splits them
 *  into FEAR (A-D) and GREED (E-F). */
export const INFLOW_ANGLES_VERIFIED: readonly SeedAngle[] = [
  {
    id: '1f10c0de-a091-4000-8000-000000000001',
    label: 'A. Frozen funds',
    body: 'The strongest one. A good month looks like fraud to an algorithm; accounts freeze exactly when a business takes off.',
    family: 'fear',
    is_verified: true,
    sort_order: 1,
  },
  {
    id: '1f10c0de-a091-4000-8000-000000000002',
    label: 'B. Waiting for your own money',
    body: 'The sale clears in 3 seconds, the payout takes 7 days.',
    family: 'fear',
    is_verified: true,
    sort_order: 2,
  },
  {
    id: '1f10c0de-a091-4000-8000-000000000003',
    label: 'C. Your country is not supported',
    body: 'Rejected for a passport or an address, not for anything about the business.',
    family: 'fear',
    is_verified: true,
    sort_order: 3,
  },
  {
    id: '1f10c0de-a091-4000-8000-000000000004',
    label: 'D. Taxes handled',
    body: 'Selling in 10 countries means obligations in 10 countries. Inflow is the official seller and files them.',
    family: 'fear',
    is_verified: true,
    sort_order: 4,
  },
  {
    id: '1f10c0de-a091-4000-8000-000000000005',
    label: 'E. The real rate',
    body: 'An advertised 2.5-2.9% becomes well past 4% once international cards, currency conversion and chargebacks stack.',
    family: 'greed',
    is_verified: true,
    sort_order: 5,
  },
  {
    id: '1f10c0de-a091-4000-8000-000000000006',
    label: 'F. You use it too',
    body: 'Speak as an actual user, not as an ad.',
    family: 'greed',
    is_verified: true,
    sort_order: 6,
  },
]

/** The two extra angles from the skill file the user maintains.
 *
 *  These appear in the brief only as product context, never as named angles.
 *  They load with is_verified false and are displayed separately. There must
 *  never be a merged list of eight - the disagreement between the two sources
 *  is information, and flattening it destroys it.
 *
 *  Family is left null rather than guessed: the brief's FEAR/GREED split is a
 *  brief construct, and nothing assigns these two to either side. */
export const INFLOW_ANGLES_UNVERIFIED: readonly SeedAngle[] = [
  {
    id: '1f10c0de-a092-4000-8000-000000000007',
    label: 'Nobody picks up',
    body: 'From the skill file the user maintains, not from the brief.',
    family: null,
    is_verified: false,
    sort_order: 7,
  },
  {
    id: '1f10c0de-a092-4000-8000-000000000008',
    label: 'Switching is not a project',
    body: 'From the skill file the user maintains, not from the brief.',
    family: null,
    is_verified: false,
    sort_order: 8,
  },
]

// ---------------------------------------------------------------------------
// The never-do list. Rendered in red.
// ---------------------------------------------------------------------------

/** Assembled from what survived the brief's PDF conversion, so it may be
 *  incomplete - which is what brief_is_incomplete on the campaign records.
 *  Marked verified because these came from the campaign's own brief, the same
 *  basis on which the six angles above are verified. */
export const INFLOW_RULES: readonly { id: string; body: string; sort_order: number }[] = [
  {
    id: '1f10c0de-4111-4000-8000-000000000001',
    body: 'Never promise anyone escapes, avoids or hides from taxes. "Escape" applies to fees, freezes and waiting, never to taxes.',
    sort_order: 1,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000002',
    body: 'Never name or attack a competitor. Say "your payment processor" or "most processors".',
    sort_order: 2,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000003',
    body: 'Never mix more than one angle into a video.',
    sort_order: 3,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000004',
    body: 'Never say "Inflow" more than once, and never during warm-up.',
    sort_order: 4,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000005',
    body: 'No filters or built-in camera effects. No fancy fonts or motion on captions - default CapCut captions, white bold, one headline.',
    sort_order: 5,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000006',
    body: 'No zoom, no shaky footage.',
    sort_order: 6,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000007',
    body: 'Every Inflow video carries #ad (or the platform’s paid partnership label) and tags @inflowpay.',
    sort_order: 7,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000008',
    body: 'Keep every approved post public for 90 days. Early removal forfeits bonus money and can reduce base pay.',
    sort_order: 8,
  },
  {
    id: '1f10c0de-4111-4000-8000-000000000009',
    body: 'No volume padding: no reposting the same or substantially the same video, no high-volume bursts to hit cadence.',
    sort_order: 9,
  },
  {
    id: '1f10c0de-4111-4000-8000-00000000000a',
    body: 'Numbers exactly as written: 4% + $0.35, instant payouts.',
    sort_order: 10,
  },
]

// ---------------------------------------------------------------------------
// Bonuses
// ---------------------------------------------------------------------------

/** Each milestone pays once per deliverable, and only views within 30 days of
 *  upload count. Probabilities are not set here - every one of them defaults
 *  to zero so the EXPECTED column reads $0 until he judges it himself. */
export const INFLOW_BONUS_TIERS = [
  {
    id: '1f10c0de-b075-4000-8000-000000000001',
    label: '50,000 views',
    threshold_views: 50_000,
    payout_cents: 5000,
    view_window_days: 30,
  },
  {
    id: '1f10c0de-b075-4000-8000-000000000002',
    label: '100,000 views',
    threshold_views: 100_000,
    payout_cents: 10_000,
    view_window_days: 30,
  },
]

/** No campaign_documents rows are seeded: the real brief and contract are not
 *  in the repository, and raw_text is NOT NULL. Inventing a plausible document
 *  body would be the single worst thing this file could do - it would let
 *  fabricated text back a `documented` field and pass the parser's own
 *  substring check. The drop box in phase 8 is how the real ones arrive. */
export const INFLOW_DOCUMENTS: readonly { kind: DocumentKind; raw_text: string }[] = []
