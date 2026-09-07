// The only persistence contract in the app.
//
// LocalAdapter implements it now over Dexie. SupabaseAdapter implements it in
// phase 9 over Postgres. No component imports Dexie or supabase-js - ever - so
// swapping one for the other, or putting one in front of the other, changes
// nothing above this line.
//
// Every method here returns as soon as the write has landed locally. Nothing in
// this interface waits on a network round trip, because he taps "posted" on a
// phone with bad signal, in a hurry, and a spinner there means the app is
// broken. Propagation to the server is the outbox's job, not the caller's.
//
// Note what this interface does NOT offer: any way to update or delete a
// phase_event. History is append-only, and the cheapest way to guarantee that
// is to give callers no verb for it.

import type {
  BonusClaim,
  BonusTier,
  Campaign,
  CampaignAccount,
  CampaignAngle,
  CampaignDocument,
  CampaignField,
  CampaignHook,
  CampaignRule,
  NewBonusTier,
  NewCampaign,
  NewCampaignAccount,
  NewCampaignAngle,
  NewCampaignDocument,
  NewCampaignHook,
  NewCampaignRule,
  NewVideo,
  NewWorkSession,
  NewVideoPost,
  PhaseEvent,
  SessionType,
  TableName,
  TimeEstimate,
  UserSettings,
  Video,
  VideoPhase,
  VideoPost,
  WarmupEvent,
  WorkSession,
} from './schema'

/** A complete, portable copy of every table. This is the backup of record:
 *  browsers block downloads in some contexts, so it is rendered into a
 *  textarea with a copy button rather than offered as a file. */
export interface BackupSnapshot {
  /** Bumped only when the shape changes in a way an importer must handle. */
  format_version: number
  exported_at: string
  campaigns: Campaign[]
  campaign_accounts: CampaignAccount[]
  campaign_documents: CampaignDocument[]
  campaign_fields: CampaignField[]
  campaign_angles: CampaignAngle[]
  campaign_hooks: CampaignHook[]
  campaign_rules: CampaignRule[]
  videos: Video[]
  video_posts: VideoPost[]
  phase_events: PhaseEvent[]
  work_sessions: WorkSession[]
  warmup_events: WarmupEvent[]
  bonus_tiers: BonusTier[]
  bonus_claims: BonusClaim[]
  time_estimates: TimeEstimate[]
  user_settings: UserSettings[]
}

export interface ImportResult {
  /** Rows written, per table. */
  counts: Record<string, number>
}

/** What a phase advance needs to know beyond the video itself. */
export interface AdvanceOptions {
  /** Recorded on the phase_event so MEASURED timings can be split by the kind
   *  of session the work happened in. */
  session?: SessionType
  /** Wall-clock seconds spent in the phase being left, where the UI measured
   *  it. Omitted rather than estimated when it was not actually measured. */
  durationSeconds?: number
  /** Which sitting this move happened in. `session` above records the kind of
   *  session; this records which one, so an evening's count and its real
   *  durations are both answerable from the log rather than from a counter
   *  held somewhere that can drift. Absent for moves made outside a session,
   *  like a tap on the tick-off list. */
  workSessionId?: string
}

/** How far a reset goes. Both sit behind a two-tap confirmation in the UI. */
export type ResetScope =
  /** Today's videos only. History, the ledger and settings survive. */
  | 'today'
  /** Everything, including the ledger and the user-entered opening balance. */
  | 'everything'

export interface DataAdapter {
  /** Runs `body` so that everything written inside it lands together or not
   *  at all.
   *
   *  Exists for one situation: creating a campaign is not one write. It is a
   *  campaign row, then its documents, then a field per extracted value, then
   *  its bonus tiers and rules. Without this, a failure partway leaves a
   *  half-built campaign - a rate with no document behind it, or a brief page
   *  with rules and no fields - and the app has no way to tell that apart from
   *  a campaign that genuinely lacks them. That is exactly the kind of
   *  plausible-looking wrong state the rest of the design works to prevent.
   *
   *  The adapter passed to `body` is the one to use inside it. Calls made on
   *  the outer adapter from within `body` are not part of the transaction.
   *
   *  Deliberately narrow. Most writes are a single row and need nothing here;
   *  reach for it only where several rows are one fact. */
  runTransaction<T>(body: (adapter: DataAdapter) => Promise<T>): Promise<T>

  // --- Campaigns ---------------------------------------------------------

  listCampaigns(options?: { includeInactive?: boolean }): Promise<Campaign[]>
  getCampaign(id: string): Promise<Campaign | null>
  createCampaign(campaign: NewCampaign): Promise<Campaign>

  /** Setting `pay_per_video_cents` on a campaign that had none also backfills
   *  the rate onto that campaign's posted-but-unpriced videos - see
   *  backfillUnpricedVideos for exactly what that does and does not touch. */
  updateCampaign(id: string, patch: Partial<Omit<Campaign, 'id' | 'user_id'>>): Promise<Campaign>

  /** Takes a campaign off every screen, for good.
   *
   *  `is_active: false`, the same soft delete as deleteCampaignAccount, and
   *  for the same two reasons. Its videos carry phase_events, and that log is
   *  append-only: a real delete would cascade through it and rewrite the
   *  history that explains every figure the app has ever shown. And a delete
   *  has to survive sync, which pushes rows - a row that is gone locally
   *  pushes nothing, so the campaign would come back on the next pull.
   *
   *  Nothing lists it afterwards: listCampaigns filters on is_active unless
   *  asked otherwise, so it stops being owed, stops being paid, and stops
   *  appearing anywhere he can reach. */
  deleteCampaign(id: string): Promise<void>

  /** Writes the campaign's current rate onto its posted videos that have no
   *  rate snapshot yet, and returns how many it changed.
   *
   *  Only videos where `rate_snapshot_cents` is null - videos posted while the
   *  campaign had no confirmed rate. A video that already snapshotted a real
   *  rate is never touched, at any rate, ever: that snapshot is what makes the
   *  ledger non-rewritable, and backfilling over it would repay past work at
   *  today's number.
   *
   *  A no-op when the campaign still has no rate. There is nothing to write,
   *  and 0 would be a fabricated "earned nothing". */
  backfillUnpricedVideos(campaignId: string): Promise<number>

  // --- Documents ---------------------------------------------------------

  /** Raw uploaded text, kept forever. */
  addCampaignDocument(document: NewCampaignDocument): Promise<CampaignDocument>
  listCampaignDocuments(campaignId: string): Promise<CampaignDocument[]>

  // --- Fields, with their provenance attached ----------------------------

  listCampaignFields(campaignId: string): Promise<CampaignField[]>

  /** Upsert by (campaign_id, field_key). The `source` decides how the field
   *  renders: `parsed_unreviewed` is amber until confirmed, `missing` reads
   *  "not saved yet". Nothing may be written as `documented` here - only
   *  confirmCampaignField promotes a field to that. */
  setCampaignField(
    field: Omit<CampaignField, 'id' | 'user_id' | 'updated_at' | 'confirmed_at'>,
  ): Promise<CampaignField>

  /** The user's tap on the review screen. Promotes a parsed field to
   *  `documented` if it cites a quote, and to `user_entered` if it does not,
   *  because a rate with no document behind it is not a documented rate. */
  confirmCampaignField(campaignId: string, fieldKey: string): Promise<CampaignField>

  // --- Angles and rules --------------------------------------------------

  listCampaignAngles(campaignId: string): Promise<CampaignAngle[]>
  addCampaignAngle(angle: NewCampaignAngle): Promise<CampaignAngle>
  listCampaignRules(campaignId: string): Promise<CampaignRule[]>
  addCampaignRule(rule: NewCampaignRule): Promise<CampaignRule>

  // --- Videos ------------------------------------------------------------

  listVideos(filter?: {
    campaignId?: string
    phases?: readonly VideoPhase[]
    owedForDate?: string
  }): Promise<Video[]>
  getVideo(id: string): Promise<Video | null>
  createVideo(video: NewVideo): Promise<Video>

  /** Field edits that are not phase movement: the pasted script, the setup
   *  override, the blocked reason. Phase is deliberately not patchable here -
   *  it moves only through advance/revert, so no path exists that changes a
   *  phase without writing the matching history row. */
  updateVideo(
    id: string,
    patch: Partial<Omit<Video, 'id' | 'user_id' | 'campaign_id' | 'phase'>>,
  ): Promise<Video>

  /** One tap. Moves the video to the next phase in its campaign's chain,
   *  appends a phase_event, and - on reaching `posted` - snapshots the
   *  campaign's current rate onto the video so the ledger cannot be rewritten
   *  by a later rate change. Atomic: the row and its history move together or
   *  not at all. */
  advanceVideoPhase(id: string, options?: AdvanceOptions): Promise<Video>

  /** Tap again to undo. Steps back one phase and appends a further event
   *  recording the reversal - history is added to, never erased. */
  revertVideoPhase(id: string, options?: AdvanceOptions): Promise<Video>

  /** Straight to posted from wherever it is.
   *
   *  This is the tick-off list's tap. He posted it on his phone an hour ago;
   *  the app is being told after the fact, and making him walk the chain five
   *  taps to record one thing that already happened would defeat the point of
   *  a screen that must not require planning anything first.
   *
   *  The skip is recorded honestly: one event, from whatever phase it was in,
   *  to posted. The log says what the app was actually told. */
  markVideoPosted(id: string, options?: AdvanceOptions): Promise<Video>

  /** Undo the most recent phase move, whatever it was.
   *
   *  Reads the last phase_event and returns the video to that event's
   *  from_phase, so undoing a skip straight to posted goes back where it came
   *  from rather than to the chain's predecessor. Appends a new event; it
   *  never deletes the one it reverses. */
  undoLastPhaseMove(id: string, options?: AdvanceOptions): Promise<Video>

  // --- Where a video went live -------------------------------------------

  /** One piece of content on two platforms is one video and two rows here -
   *  still a single deliverable. */
  addVideoPost(post: NewVideoPost): Promise<VideoPost>

  /** Untick: this video did not go out on that account after all. Deleted
   *  rather than flagged - video_posts records where a video actually is, and
   *  a row saying "not here" is not a record of anything. The phase_event
   *  history of the posting itself is untouched and stays append-only: what is
   *  removed is the claim about where the video currently sits, never the log
   *  of what happened. */
  removeVideoPost(videoId: string, accountId: string): Promise<void>
  listVideoPosts(videoId: string): Promise<VideoPost[]>
  setViewCount(videoPostId: string, viewCount: number): Promise<VideoPost>

  // --- History. Readable and appendable, never editable ------------------

  listPhaseEvents(filter?: { videoId?: string; since?: string }): Promise<PhaseEvent[]>

  // --- Warm-up. Readable and appendable, never editable -------------------
  //
  // "Warmed up twice" is a count taken from this log, never a mutable number
  // on the campaign - the same reasoning, for the same reason, as phase_events.

  listWarmupEvents(filter?: { campaignId?: string }): Promise<WarmupEvent[]>

  /** One completed warm-up session for this campaign's account, for the
   *  minutes the session actually ran. */
  /** Records one completed warm-up session against an account, and promotes
   *  the account once it has enough of them. The campaign is resolved from the
   *  account rather than passed, so the two can never disagree. */
  recordWarmupEvent(accountId: string, minutes: number): Promise<WarmupEvent>

  // --- Accounts ----------------------------------------------------------
  //
  // Where a campaign actually posts. One video is cross-posted to every one of
  // them and is still one deliverable, which is contractual for Inflow. These
  // replace the handle_tiktok / handle_instagram fields: a handle was never a
  // claim about a document - no brief states one - and a single per-campaign
  // quota could not say "1 on TikTok, 1 on Instagram" or "2 on YouTube, 2 on
  // Instagram".

  listCampaignAccounts(campaignId?: string): Promise<CampaignAccount[]>
  addCampaignAccount(account: NewCampaignAccount): Promise<CampaignAccount>
  updateCampaignAccount(
    id: string,
    patch: Partial<Omit<CampaignAccount, 'id' | 'user_id' | 'campaign_id'>>,
  ): Promise<CampaignAccount>
  deleteCampaignAccount(id: string): Promise<void>

  // --- Work sessions -----------------------------------------------------
  //
  // One sitting: a campaign, a goal of N videos and a window. This holds the
  // intent and the wall-clock bracket, and deliberately holds no progress
  // counter - "3 of 7 done" is counted from phase_events at query time, the
  // same reasoning as "warmed up twice". A stored counter drifts from the log
  // that explains it, and the log is what measured timings come from.

  listWorkSessions(filter?: { campaignId?: string; openOnly?: boolean }): Promise<WorkSession[]>
  startWorkSession(session: NewWorkSession): Promise<WorkSession>

  /** Closes it. Idempotent: a session already ended keeps its first end time,
   *  because a reopened tab should not extend an evening that finished. */
  endWorkSession(id: string): Promise<WorkSession>

  // --- Hooks -------------------------------------------------------------
  //
  // Not campaign_fields: a field is a claim about a document and carries a
  // quote that can be checked against it. A hook is invented text that no
  // document contains, so the honest question is a different one - who made
  // this up, when, and with what - which is what `source`, `model` and
  // `generated_at` answer.

  listCampaignHooks(campaignId: string, filter?: { unusedOnly?: boolean }): Promise<CampaignHook[]>
  addCampaignHook(hook: NewCampaignHook): Promise<CampaignHook>

  /** Marks a hook used so it is not offered again, or clears that mark. */
  setHookUsed(id: string, used: boolean): Promise<CampaignHook>

  /** Deletes a hook. Material, not history: nothing is preserved. */
  deleteCampaignHook(id: string): Promise<void>

  // --- Money -------------------------------------------------------------

  listBonusTiers(campaignId: string): Promise<BonusTier[]>
  addBonusTier(tier: NewBonusTier): Promise<BonusTier>
  listBonusClaims(filter?: { videoId?: string }): Promise<BonusClaim[]>

  /** EXPECTED bonus. The probability is one the user typed; it defaults to
   *  zero and is never inferred from view counts or past performance. */
  setBonusProbability(videoId: string, bonusTierId: string, probability: number): Promise<BonusClaim>

  /** USER ENTERED bonus. Only what was actually logged as received. */
  recordBonusReceived(
    videoId: string,
    bonusTierId: string,
    receivedCents: number,
    receivedAt: string,
  ): Promise<BonusClaim>

  // --- Settings and estimates --------------------------------------------

  getUserSettings(): Promise<UserSettings>
  updateUserSettings(patch: Partial<Omit<UserSettings, 'user_id'>>): Promise<UserSettings>
  listTimeEstimates(): Promise<TimeEstimate[]>
  upsertTimeEstimate(estimate: Omit<TimeEstimate, 'id' | 'user_id'>): Promise<TimeEstimate>

  // --- Backup ------------------------------------------------------------

  exportAll(): Promise<BackupSnapshot>

  /** Replaces everything with the snapshot's contents. Every row is validated
   *  against the schema constraints first, and the whole import runs in one
   *  transaction: a snapshot that fails validation leaves the store untouched
   *  rather than half-written. */
  importAll(snapshot: unknown): Promise<ImportResult>

  reset(scope: ResetScope): Promise<void>

  // --- The outbox --------------------------------------------------------
  //
  // Every write enqueues one of these. Draining them is what "syncs in the
  // background" means: the queue is the record of what the server has not been
  // told yet, and it is the reason no user action ever waits on a network.

  /** Oldest first, so writes reach the server in the order they happened. */
  listPendingWrites(limit?: number): Promise<PendingWrite[]>

  /** The server has it. Drop it from the queue. */
  markWriteSynced(id: number): Promise<void>

  /** Push failed. Records the reason and counts the attempt, leaving the entry
   *  queued so the next drain tries again. */
  markWriteFailed(id: number, reason: string): Promise<void>

  /** Replaces a local row with the server's version, without enqueuing the
   *  change - the server already has it, and echoing it back would loop. */
  applyRemoteRow(table: TableName, row: unknown): Promise<void>
  /** Rewrites every row from the local user id to a real account id, once.
   *
   *  Local rows are minted with an id from localStorage, because there is no
   *  auth.uid() before sign-in. On the first sign-in every row has to be
   *  reassigned to the real account or RLS refuses all of them and the first
   *  sync silently pushes nothing - the worst possible failure, because it
   *  looks exactly like success.
   *
   *  Atomic, and a no-op when the rows already belong to that account, so
   *  running it twice cannot split the data between two owners.
   *
   *  Pending outbox entries are rewritten too. They were queued under the old
   *  id and would be refused on arrival otherwise. */
  claimRowsForUser(userId: string): Promise<ClaimResult>

  /** Queues every local row the server may not have, and returns how many.
   *
   *  The outbox only ever held what was enqueued at the moment of the write,
   *  and two things were never enqueued: rows written before a write path
   *  learned to queue them, and rows created inside a Dexie upgrade, which
   *  writes to the store directly and so bypasses the queue entirely.
   *
   *  claimRowsForUser sweeps everything, but only while actually claiming -
   *  it returns early once the rows already belong to the account - so after
   *  the first sign-in there was no path that could ever carry that history
   *  to the server. This is that path.
   *
   *  Safe to run more than once: mutable tables upsert, and append-only
   *  tables are deduplicated by client_id on arrival. */
  backfillOutbox(): Promise<number>
}

export interface ClaimResult {
  /** False when the rows already belonged to this account. */
  claimed: boolean
  rowsClaimed: number
  pendingWritesRewritten: number
  previousUserId: string
}

/** A write waiting to go to the server. */
export interface PendingWrite {
  id: number
  table_name: TableName
  row_id: string
  op: 'insert' | 'update' | 'delete'
  /** The row as it stood after the write. For a delete, as it stood before -
   *  the server is told which row to remove, and the payload is kept so a
   *  stuck entry can say what it was going to drop. */
  payload: unknown
  queued_at: string
  attempts: number
  last_error?: string | null
}
