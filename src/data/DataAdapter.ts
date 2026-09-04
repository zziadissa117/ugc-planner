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
  CampaignAngle,
  CampaignDocument,
  CampaignField,
  CampaignRule,
  NewBonusTier,
  NewCampaign,
  NewCampaignAngle,
  NewCampaignDocument,
  NewCampaignRule,
  NewVideo,
  NewVideoPost,
  PhaseEvent,
  SessionType,
  TimeEstimate,
  UserSettings,
  Video,
  VideoPhase,
  VideoPost,
} from './schema'

/** A complete, portable copy of every table. This is the backup of record:
 *  browsers block downloads in some contexts, so it is rendered into a
 *  textarea with a copy button rather than offered as a file. */
export interface BackupSnapshot {
  /** Bumped only when the shape changes in a way an importer must handle. */
  format_version: number
  exported_at: string
  campaigns: Campaign[]
  campaign_documents: CampaignDocument[]
  campaign_fields: CampaignField[]
  campaign_angles: CampaignAngle[]
  campaign_rules: CampaignRule[]
  videos: Video[]
  video_posts: VideoPost[]
  phase_events: PhaseEvent[]
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
}

/** How far a reset goes. Both sit behind a two-tap confirmation in the UI. */
export type ResetScope =
  /** Today's videos only. History, the ledger and settings survive. */
  | 'today'
  /** Everything, including the ledger and the user-entered opening balance. */
  | 'everything'

export interface DataAdapter {
  // --- Campaigns ---------------------------------------------------------

  listCampaigns(options?: { includeInactive?: boolean }): Promise<Campaign[]>
  getCampaign(id: string): Promise<Campaign | null>
  createCampaign(campaign: NewCampaign): Promise<Campaign>
  updateCampaign(id: string, patch: Partial<Omit<Campaign, 'id' | 'user_id'>>): Promise<Campaign>

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

  // --- Where a video went live -------------------------------------------

  /** One piece of content on two platforms is one video and two rows here -
   *  still a single deliverable. */
  addVideoPost(post: NewVideoPost): Promise<VideoPost>
  listVideoPosts(videoId: string): Promise<VideoPost[]>
  setViewCount(videoPostId: string, viewCount: number): Promise<VideoPost>

  // --- History. Readable and appendable, never editable ------------------

  listPhaseEvents(filter?: { videoId?: string; since?: string }): Promise<PhaseEvent[]>

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
}
