// The fitting weights, in one place, with a comment per weight.
//
// Scores are arbitrary points - only their ratios matter. They are tuned so
// the ordering SPEC section 8 asks for holds: contracted work owed today beats
// everything, approval-gated work front-loads because it needs lead time, and
// pay and setup continuity decide the rest.
//
// Every one of these is a judgement about priority, not a fact about a
// campaign. Nothing here reads a rate, a quota or a rule - those come from the
// user or a document, and the algorithm only weighs what it is handed.

export const FITTING_WEIGHTS = {
  /** Work the quota owes today.
   *
   *  This only orders owed work against other owed work. Its precedence over
   *  everything else is structural rather than numeric: fitSession packs owed
   *  work in its own pass first, so a later pass can only use time that pass
   *  did not want. A weight could not have promised that - any value large
   *  enough to outrank a rich enough optional video is arbitrary, and any
   *  value smaller lets that video take tonight's obligated slot. */
  owedToday: 1000,

  // approvalGated lived here: extra points for work that had to wait on a
  // brand before it could go out. It was removed with the submitted/approved
  // phases - the app is never told when a brand approves anything, so it
  // cannot know a video is waiting, and scoring it as though it did was
  // guessing dressed as priority.

  /** Points per dollar of the campaign's pay per video. $35 -> 175 points. */
  payPerVideoPerDollar: 5,

  /** Points per dollar per minute of production time in this stage. Rewards
   *  the video that returns the most for the time it actually costs tonight.
   *  $35 over 12 film minutes -> about 58 points. */
  payPerMinutePerDollar: 20,

  /** Staying in the setup already in use. Small on its own - the real cost of
   *  a switch is the minutes it burns, charged separately. */
  sameSetup: 60,

  /** Points charged against a setup change, per minute of
   *  `user_settings.setup_switch_minutes`. At the default 10 minutes this is a
   *  60 point penalty, so a switch has to be worth more than about $12 of pay
   *  difference before it is taken. This is what makes the switch cost
   *  "outweigh a small gain in value". */
  switchPenaltyPerMinute: 6,

  /** Points per dollar of bonus upside: payout times the probability the user
   *  typed. Every probability defaults to zero, so this contributes nothing at
   *  all until he has judged one himself. It is never inferred from view
   *  counts or past performance. */
  bonusUpsidePerDollar: 2,

  /** Points per day an approved video has been sitting unposted, in a POST
   *  session. Approved stock going stale is the thing most at risk: it was
   *  cleared to post and is earning nothing while it waits. */
  readyAgingPerDay: 25,

  /** New supply generated to fill leftover FILM time. Ranks below anything
   *  already owed or already in the pipeline, because stock is worth making
   *  only once tonight's actual obligations are covered. */
  newSupply: 50,
} as const

export type FittingWeights = typeof FITTING_WEIGHTS
