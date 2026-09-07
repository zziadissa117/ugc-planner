// DataAdapter over Dexie/IndexedDB.
//
// Every method writes locally and returns. Nothing here awaits a network call,
// because nothing here has one to await - and that stays true once
// SupabaseAdapter exists, because propagation is the outbox drain's job and it
// runs behind the user, never in front of them.
//
// Two things this file is responsible for that IndexedDB is not:
//   - the constraints from docs/schema.sql, enforced via ../constraints
//   - foreign keys, checked inside the transaction that needs them

import type { Table, Transaction } from 'dexie'

import type {
  AdvanceOptions,
  BackupSnapshot,
  ClaimResult,
  DataAdapter,
  ImportResult,
  PendingWrite,
  ResetScope,
} from '../DataAdapter'
import { ConstraintError, assertRow } from '../constraints'
import { DEFAULT_SETUP_SWITCH_MINUTES, DEFAULT_TIME_ESTIMATES } from '../defaults'
import { nextPhase, previousPhase } from '../phases'
import { statusAfterWarmup, warmupCompletions } from '../warmup'
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
  TableName,
  TimeEstimate,
  UserSettings,
  Video,
  VideoPhase,
  VideoPost,
  WarmupEvent,
  WorkSession,
} from '../schema'
import { LocalDatabase, MIRRORED_TABLES, type OutboxEntry } from './db'

/** Raised for things the schema cannot express: advancing past the end of a
 *  chain, a foreign key pointing at nothing, a row that is not there. */
export class DataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataError'
  }
}

const USER_ID_KEY = 'ugc-planner.local_user_id'

/** Until Supabase Auth exists there is no real auth.uid(), but user_id is NOT
 *  NULL on every table and the local store mirrors the schema exactly. So one
 *  stable local id is minted on first run and used throughout. When sync
 *  arrives, these rows are rewritten once to the real account id. */
function localUserId(): string {
  try {
    const existing = localStorage.getItem(USER_ID_KEY)
    if (existing) return existing
    const minted = crypto.randomUUID()
    localStorage.setItem(USER_ID_KEY, minted)
    return minted
  } catch {
    // Private mode, or storage blocked. A per-session id still lets the app
    // run; IndexedDB is the store that actually matters.
    return '00000000-0000-4000-8000-000000000000'
  }
}

const now = (): string => new Date().toISOString()
const newId = (): string => crypto.randomUUID()

/** Today as YYYY-MM-DD in the user's own zone. The posting quota resets at his
 *  midnight, not at UTC's. */
export function localToday(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export class LocalAdapter implements DataAdapter {
  private readonly db: LocalDatabase
  private userId: string

  constructor(db: LocalDatabase = new LocalDatabase(), userId: string = localUserId()) {
    this.db = db
    this.userId = userId
  }

  // --- Plumbing ----------------------------------------------------------

  /** Runs a transaction and guarantees the caller sees the error that was
   *  actually thrown.
   *
   *  When something throws after an await inside a Dexie transaction, the
   *  transaction aborts and the promise rejects with Dexie's abort error
   *  instead - it copies the original's `name` but not its prototype, so
   *  `instanceof ConstraintError` comes back false. That matters well beyond
   *  tests: the review screen has to tell "this row breaks a rule, show it in
   *  amber" apart from "the disk failed". So the original is captured on the
   *  way out and rethrown once the transaction has finished unwinding. */
  private async tx<T>(tables: Table[], body: (tx: Transaction) => Promise<T>): Promise<T> {
    let thrown: unknown
    let didThrow = false
    try {
      return await this.db.transaction('rw', tables, async (transaction) => {
        try {
          return await body(transaction)
        } catch (error) {
          thrown = error
          didThrow = true
          throw error
        }
      })
    } catch (error) {
      throw didThrow ? thrown : error
    }
  }

  /** Opens one transaction over every table and runs `body` inside it.
   *
   *  The adapter handed back is `this`. Dexie tracks the open transaction for
   *  the scope, so the per-method transactions the writes open individually
   *  join this one instead of starting their own - they are all subsets of it.
   *  So the existing methods need no transaction-aware variants, and a throw
   *  anywhere inside rolls back everything, including the outbox entries. */
  async runTransaction<T>(body: (adapter: DataAdapter) => Promise<T>): Promise<T> {
    return this.tx([...MIRRORED_TABLES.map((t) => this.db.table(t)), this.db._outbox], async () =>
      body(this),
    )
  }

  /** Queue a write for the server. Phase 9 drains this; today it is a record
   *  of what would be sent, which keeps every write path local-first now
   *  rather than after a rewrite later. */
  private enqueue(
    tx: Transaction,
    table_name: TableName,
    row_id: string,
    op: OutboxEntry['op'],
    payload: unknown,
  ): void {
    // Fire-and-forget inside the transaction: it commits or rolls back with
    // the row it describes, so the queue can never disagree with the store.
    void tx.table('_outbox').add({
      table_name,
      row_id,
      op,
      payload,
      queued_at: now(),
      attempts: 0,
    } satisfies Omit<OutboxEntry, 'id'>)
  }

  /** IndexedDB has no foreign keys, so the ones that matter are checked here,
   *  inside the transaction doing the write. */
  private async requireRow(tx: Transaction, table: TableName, id: string): Promise<unknown> {
    const row = await tx.table(table).get(id)
    if (!row) throw new DataError(`${table} ${id} does not exist`)
    return row
  }

  // --- Campaigns ---------------------------------------------------------

  async listCampaigns(options?: { includeInactive?: boolean }): Promise<Campaign[]> {
    const all = await this.db.campaigns.toArray()
    const kept = options?.includeInactive ? all : all.filter((c) => c.is_active)
    return kept.sort((a, b) => a.name.localeCompare(b.name))
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    return (await this.db.campaigns.get(id)) ?? null
  }

  async createCampaign(campaign: NewCampaign): Promise<Campaign> {
    const timestamp = now()
    const row: Campaign = {
      id: campaign.id ?? newId(),
      user_id: this.userId,
      name: campaign.name,
      company: campaign.company,
      is_active: campaign.is_active ?? true,
      approval_mode: campaign.approval_mode ?? 'none',
      default_setup: campaign.default_setup,
      daily_post_quota: campaign.daily_post_quota ?? 0,
      pay_per_video_cents: campaign.pay_per_video_cents,
      cycle_size: campaign.cycle_size,
      opening_post_count: campaign.opening_post_count ?? 0,
      brief_is_incomplete: campaign.brief_is_incomplete ?? false,
      created_at: campaign.created_at ?? timestamp,
      updated_at: campaign.updated_at ?? timestamp,
    }
    assertRow('campaigns', row)

    await this.tx([this.db.campaigns, this.db._outbox], async (tx) => {
      await tx.table('campaigns').add(row)
      this.enqueue(tx, 'campaigns', row.id, 'insert', row)
    })
    return row
  }

  async updateCampaign(
    id: string,
    patch: Partial<Omit<Campaign, 'id' | 'user_id'>>,
  ): Promise<Campaign> {
    return this.tx([this.db.campaigns, this.db.videos, this.db._outbox], async (tx) => {
      const existing = (await this.requireRow(tx, 'campaigns', id)) as Campaign
      const row: Campaign = { ...existing, ...patch, updated_at: now() }
      assertRow('campaigns', row)
      await tx.table('campaigns').put(row)
      this.enqueue(tx, 'campaigns', id, 'update', row)

      // A campaign that had no rate now has one, so the posts made while it
      // had none can finally be priced. Same transaction: the rate and the
      // videos it explains land together or not at all.
      if (existing.pay_per_video_cents === null && row.pay_per_video_cents !== null) {
        await this.backfillWithin(tx, row)
      }

      return row
    })
  }

  async backfillUnpricedVideos(campaignId: string): Promise<number> {
    return this.tx([this.db.campaigns, this.db.videos, this.db._outbox], async (tx) => {
      const campaign = (await this.requireRow(tx, 'campaigns', campaignId)) as Campaign
      return this.backfillWithin(tx, campaign)
    })
  }

  /** Prices the campaign's posted-but-unpriced videos at its current rate.
   *
   *  The filter is the whole point: `rate_snapshot_cents === null` and nothing
   *  else. A video that already carries a snapshot keeps it forever, because
   *  that snapshot is what stops a rate change from rewriting what past work
   *  earned. This only ever fills in a blank. */
  private async backfillWithin(tx: Transaction, campaign: Campaign): Promise<number> {
    if (campaign.pay_per_video_cents === null) return 0

    const posted = (await tx
      .table('videos')
      .where('[campaign_id+phase]')
      .equals([campaign.id, 'posted'])
      .toArray()) as Video[]

    const unpriced = posted.filter((video) => video.rate_snapshot_cents === null)
    const timestamp = now()

    for (const video of unpriced) {
      const row: Video = {
        ...video,
        rate_snapshot_cents: campaign.pay_per_video_cents,
        updated_at: timestamp,
      }
      assertRow('videos', row)
      await tx.table('videos').put(row)
      this.enqueue(tx, 'videos', row.id, 'update', row)
    }

    return unpriced.length
  }

  // --- Documents ---------------------------------------------------------

  async addCampaignDocument(document: NewCampaignDocument): Promise<CampaignDocument> {
    const row: CampaignDocument = {
      id: document.id ?? newId(),
      user_id: this.userId,
      campaign_id: document.campaign_id,
      kind: document.kind,
      filename: document.filename,
      raw_text: document.raw_text,
      uploaded_at: document.uploaded_at ?? now(),
    }
    assertRow('campaign_documents', row)

    await this.tx([this.db.campaign_documents,
      this.db.campaigns,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'campaigns', row.campaign_id)
        await tx.table('campaign_documents').add(row)
        this.enqueue(tx, 'campaign_documents', row.id, 'insert', row)
      })
    return row
  }

  async listCampaignDocuments(campaignId: string): Promise<CampaignDocument[]> {
    return this.db.campaign_documents.where('campaign_id').equals(campaignId).toArray()
  }

  // --- Fields ------------------------------------------------------------

  async listCampaignFields(campaignId: string): Promise<CampaignField[]> {
    return this.db.campaign_fields.where('campaign_id').equals(campaignId).toArray()
  }

  async setCampaignField(
    field: Omit<CampaignField, 'id' | 'user_id' | 'updated_at' | 'confirmed_at'>,
  ): Promise<CampaignField> {
    if (field.source === 'documented') {
      // Only a confirmation tap can produce a documented field, and it needs a
      // quote to back it. Writing one directly would let a parsed guess be
      // stored as though a human had checked it against the document.
      throw new DataError(
        'a field cannot be written as `documented` - confirm it via confirmCampaignField',
      )
    }

    return this.tx([this.db.campaign_fields,
      this.db.campaigns,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'campaigns', field.campaign_id)
        const existing = await tx
          .table('campaign_fields')
          .where('[campaign_id+field_key]')
          .equals([field.campaign_id, field.field_key])
          .first()

        const row: CampaignField = {
          id: (existing as CampaignField | undefined)?.id ?? newId(),
          user_id: this.userId,
          campaign_id: field.campaign_id,
          field_key: field.field_key,
          field_value: field.field_value,
          source: field.source,
          source_quote: field.source_quote,
          source_document_id: field.source_document_id,
          // Re-setting a field un-confirms it: the value changed, so whatever
          // was previously checked no longer describes what is stored.
          confirmed_at: null,
          updated_at: now(),
        }
        assertRow('campaign_fields', row)
        await tx.table('campaign_fields').put(row)
        this.enqueue(tx, 'campaign_fields', row.id, existing ? 'update' : 'insert', row)
        return row
      })
  }

  async confirmCampaignField(campaignId: string, fieldKey: string): Promise<CampaignField> {
    return this.tx([this.db.campaign_fields, this.db._outbox], async (tx) => {
      const existing = (await tx
        .table('campaign_fields')
        .where('[campaign_id+field_key]')
        .equals([campaignId, fieldKey])
        .first()) as CampaignField | undefined
      if (!existing) throw new DataError(`campaign_fields ${campaignId}/${fieldKey} does not exist`)

      if (existing.source === 'missing') {
        // There is nothing to confirm. A field nobody found stays "not saved
        // yet" until someone types a value into it.
        throw new DataError('a missing field has no value to confirm')
      }

      const row: CampaignField = {
        ...existing,
        // A quote means the value can be pointed at in the real document, so
        // it becomes DOCUMENTED. Without one it is only ever the user's own
        // word for it, which is user_entered - a real distinction, because
        // "documented rate" is a claim about a contract.
        source: existing.source_quote !== null ? 'documented' : 'user_entered',
        confirmed_at: now(),
        updated_at: now(),
      }
      assertRow('campaign_fields', row)
      await tx.table('campaign_fields').put(row)
      this.enqueue(tx, 'campaign_fields', row.id, 'update', row)
      return row
    })
  }

  // --- Angles and rules --------------------------------------------------

  async listCampaignAngles(campaignId: string): Promise<CampaignAngle[]> {
    const rows = await this.db.campaign_angles.where('campaign_id').equals(campaignId).toArray()
    return rows.sort((a, b) => a.sort_order - b.sort_order)
  }

  async addCampaignAngle(angle: NewCampaignAngle): Promise<CampaignAngle> {
    const row: CampaignAngle = {
      id: angle.id ?? newId(),
      user_id: this.userId,
      campaign_id: angle.campaign_id,
      label: angle.label,
      body: angle.body,
      family: angle.family,
      is_verified: angle.is_verified ?? false,
      sort_order: angle.sort_order ?? 0,
      updated_at: now(),
    }
    assertRow('campaign_angles', row)

    await this.tx([this.db.campaign_angles,
      this.db.campaigns,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'campaigns', row.campaign_id)
        await tx.table('campaign_angles').add(row)
        this.enqueue(tx, 'campaign_angles', row.id, 'insert', row)
      })
    return row
  }

  async listCampaignRules(campaignId: string): Promise<CampaignRule[]> {
    const rows = await this.db.campaign_rules.where('campaign_id').equals(campaignId).toArray()
    return rows.sort((a, b) => a.sort_order - b.sort_order)
  }

  async addCampaignRule(rule: NewCampaignRule): Promise<CampaignRule> {
    const row: CampaignRule = {
      id: rule.id ?? newId(),
      user_id: this.userId,
      campaign_id: rule.campaign_id,
      body: rule.body,
      is_verified: rule.is_verified ?? false,
      sort_order: rule.sort_order ?? 0,
      updated_at: now(),
    }
    assertRow('campaign_rules', row)

    await this.tx([this.db.campaign_rules,
      this.db.campaigns,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'campaigns', row.campaign_id)
        await tx.table('campaign_rules').add(row)
        this.enqueue(tx, 'campaign_rules', row.id, 'insert', row)
      })
    return row
  }

  // --- Videos ------------------------------------------------------------

  async listVideos(filter?: {
    campaignId?: string
    phases?: readonly VideoPhase[]
    owedForDate?: string
  }): Promise<Video[]> {
    let rows: Video[]
    if (filter?.campaignId) {
      rows = await this.db.videos.where('campaign_id').equals(filter.campaignId).toArray()
    } else if (filter?.owedForDate) {
      rows = await this.db.videos.where('owed_for_date').equals(filter.owedForDate).toArray()
    } else {
      rows = await this.db.videos.toArray()
    }

    if (filter?.phases) {
      const wanted = new Set(filter.phases)
      rows = rows.filter((v) => wanted.has(v.phase))
    }
    if (filter?.owedForDate && filter.campaignId) {
      rows = rows.filter((v) => v.owed_for_date === filter.owedForDate)
    }

    // Ordered by (created_at, id). The point is not the order itself but that
    // it cannot change: the NOW screen requires rows to hold still under a
    // thumb mid-tap, so the sort key must contain nothing a tap can alter -
    // not phase, not posted_at, not updated_at.
    //
    // created_at only has millisecond resolution, so videos created in the
    // same tick tie and fall back to id, which is a random UUID. That order is
    // arbitrary but fixed, which is all this needs to be. Anything that wants
    // a meaningful order - the fitting algorithm in phase 5 - sorts on top of
    // this rather than relying on it.
    return rows.sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  }

  async getVideo(id: string): Promise<Video | null> {
    return (await this.db.videos.get(id)) ?? null
  }

  async createVideo(video: NewVideo): Promise<Video> {
    const timestamp = now()
    const row: Video = {
      id: video.id ?? newId(),
      user_id: this.userId,
      campaign_id: video.campaign_id,
      kind: video.kind ?? 'contracted',
      setup: video.setup,
      angle_id: video.angle_id,
      phase: video.phase ?? 'to_film',
      script: video.script,
      blocked_reason: video.blocked_reason,
      owed_for_date: video.owed_for_date,
      rate_snapshot_cents: video.rate_snapshot_cents,
      posted_at: video.posted_at,
      created_at: video.created_at ?? timestamp,
      updated_at: video.updated_at ?? timestamp,
    }
    assertRow('videos', row)

    await this.tx([this.db.videos,
      this.db.campaigns,
      this.db.phase_events,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'campaigns', row.campaign_id)
        await tx.table('videos').add(row)
        // The video entering the pipeline is itself history.
        const opening = {
          user_id: this.userId,
          video_id: row.id,
          from_phase: null,
          to_phase: row.phase,
          session: null,
          work_session_id: null,
          occurred_at: row.created_at,
          duration_seconds: null,
          // Minted here, before the row lands, so the same key travels with
          // every retry of the push that eventually carries it.
          client_id: newId(),
        }
        const openingId = await tx.table('phase_events').add(opening)
        // The row first, then the history that explains it. phase_events.video_id
        // is a foreign key, so an event pushed ahead of its video is rejected.
        this.enqueue(tx, 'videos', row.id, 'insert', row)
        // History is enqueued like any other write. Without this the log stays
        // on the device: phase_events would only ever reach the server via the
        // one-off sweep in claimRowsForUser, so every move made after sign-in
        // would be lost to the server, and MEASURED timings with it.
        this.enqueue(tx, 'phase_events', String(openingId), 'insert', {
          ...opening,
          id: openingId as number,
        })
      })
    return row
  }

  async updateVideo(
    id: string,
    patch: Partial<Omit<Video, 'id' | 'user_id' | 'campaign_id' | 'phase'>>,
  ): Promise<Video> {
    return this.tx([this.db.videos, this.db._outbox], async (tx) => {
      const existing = (await this.requireRow(tx, 'videos', id)) as Video
      const row: Video = { ...existing, ...patch, updated_at: now() }
      assertRow('videos', row)
      await tx.table('videos').put(row)
      this.enqueue(tx, 'videos', id, 'update', row)
      return row
    })
  }

  async advanceVideoPhase(id: string, options?: AdvanceOptions): Promise<Video> {
    return this.movePhase(id, 'forward', options)
  }

  async revertVideoPhase(id: string, options?: AdvanceOptions): Promise<Video> {
    return this.movePhase(id, 'back', options)
  }

  async markVideoPosted(id: string, options?: AdvanceOptions): Promise<Video> {
    return this.tx(
      [this.db.videos, this.db.campaigns, this.db.phase_events, this.db._outbox],
      async (tx) => {
        const video = (await this.requireRow(tx, 'videos', id)) as Video
        const campaign = (await this.requireRow(tx, 'campaigns', video.campaign_id)) as Campaign
        if (video.phase === 'posted') return video
        // Straight there from wherever it is. The event records the real jump
        // rather than inventing the intermediate steps he never told us about.
        return this.applyPhase(tx, video, campaign, 'posted', options)
      },
    )
  }

  async undoLastPhaseMove(id: string, options?: AdvanceOptions): Promise<Video> {
    return this.tx(
      [this.db.videos, this.db.campaigns, this.db.phase_events, this.db._outbox],
      async (tx) => {
        const video = (await this.requireRow(tx, 'videos', id)) as Video
        const campaign = (await this.requireRow(tx, 'campaigns', video.campaign_id)) as Campaign

        const events = (await tx
          .table('phase_events')
          .where('video_id')
          .equals(id)
          .toArray()) as PhaseEvent[]
        const last = events.sort((a, b) => a.id - b.id).at(-1)

        if (!last || last.from_phase === null) {
          // The only event with a null from_phase is the video's creation, and
          // undoing a video into not existing is not an undo.
          throw new DataError(`video ${id} has no phase move to undo`)
        }

        return this.applyPhase(tx, video, campaign, last.from_phase, options)
      },
    )
  }

  /** The one-tap interaction, and the only path that changes a video's phase.
   *  The row moves and its history row is written in the same transaction, so
   *  there is no state in which a video has advanced but the log does not say
   *  so. */
  private async movePhase(
    id: string,
    direction: 'forward' | 'back',
    options?: AdvanceOptions,
  ): Promise<Video> {
    return this.tx([this.db.videos,
      this.db.campaigns,
      this.db.phase_events,
      this.db._outbox], async (tx) => {
        const video = (await this.requireRow(tx, 'videos', id)) as Video
        const campaign = (await this.requireRow(tx, 'campaigns', video.campaign_id)) as Campaign

        const target =
          direction === 'forward'
            ? nextPhase(video.phase, campaign.approval_mode, video.kind)
            : previousPhase(video.phase, campaign.approval_mode, video.kind)

        if (target === null) {
          throw new DataError(
            direction === 'forward'
              ? `video ${id} is already at the end of its chain (${video.phase})`
              : `video ${id} is already at the start of its chain (${video.phase})`,
          )
        }

        return this.applyPhase(tx, video, campaign, target, options)
      })
  }

  /** Moves a video to `target` and appends the matching history row. Shared by
   *  the chain step, the skip straight to posted, and the undo, so all three
   *  handle the rate snapshot and the log identically. */
  private async applyPhase(
    tx: Transaction,
    video: Video,
    campaign: Campaign,
    target: VideoPhase,
    options?: AdvanceOptions,
  ): Promise<Video> {
    const id = video.id
    const timestamp = now()
    const row: Video = { ...video, phase: target, updated_at: timestamp }

    if (target === 'posted') {
      row.posted_at = timestamp
      // RATE SNAPSHOT. What the campaign pays right now is locked onto the
      // video, so a later rate change cannot rewrite what past work earned.
      //
      // A campaign with no confirmed rate leaves this null, which means
      // UNPRICED - not free, and not zero. The posting tap still goes through,
      // because a detail he can fill in later must never block work he can do
      // right now. Phase 7 keeps unpriced videos out of the DOCUMENTED figure,
      // counts them in amber, and backfills the snapshot onto exactly those
      // videos once the rate is confirmed.
      row.rate_snapshot_cents = campaign.pay_per_video_cents
    }

    if (video.phase === 'posted' && target !== 'posted') {
      // Undoing a post. The snapshot is cleared so that re-posting takes a
      // fresh one; leaving a stale rate attached would silently price the next
      // post at an old number.
      row.posted_at = null
      row.rate_snapshot_cents = null
    }

    assertRow('videos', row)
    await tx.table('videos').put(row)

    // Append-only, in every direction. An undo is a new event recording the
    // move back, never the deletion of the event it reverses - the log is what
    // MEASURED timings are derived from, and it has to show what happened.
    const event: Omit<PhaseEvent, 'id'> = {
      user_id: this.userId,
      video_id: id,
      from_phase: video.phase,
      to_phase: target,
      session: options?.session ?? null,
      work_session_id: options?.workSessionId ?? null,
      occurred_at: timestamp,
      duration_seconds: options?.durationSeconds ?? null,
      // Minted here, before the row lands, so the same key travels with every
      // retry of the push that eventually carries it.
      client_id: newId(),
    }
    const eventId = await tx.table('phase_events').add(event)
    // Same order as createVideo: the row, then the history that explains it.
    this.enqueue(tx, 'videos', id, 'update', row)
    this.enqueue(tx, 'phase_events', String(eventId), 'insert', {
      ...event,
      id: eventId as number,
    })
    return row
  }

  // --- Video posts -------------------------------------------------------

  async addVideoPost(post: NewVideoPost): Promise<VideoPost> {
    const row: VideoPost = {
      id: post.id ?? newId(),
      user_id: this.userId,
      video_id: post.video_id,
      account_id: post.account_id ?? null,
      platform: post.platform,
      url: post.url,
      posted_at: post.posted_at ?? now(),
      view_count: post.view_count,
      view_count_entered_at: post.view_count_entered_at,
      updated_at: post.updated_at ?? now(),
    }
    assertRow('video_posts', row)

    await this.tx([this.db.video_posts,
      this.db.videos,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'videos', row.video_id)
        await tx.table('video_posts').add(row)
        this.enqueue(tx, 'video_posts', row.id, 'insert', row)
      })
    return row
  }

  async removeVideoPost(videoId: string, accountId: string): Promise<void> {
    await this.tx([this.db.video_posts, this.db._outbox], async (tx) => {
      const rows = (await tx
        .table('video_posts')
        .where('video_id')
        .equals(videoId)
        .toArray()) as VideoPost[]

      for (const row of rows.filter((r) => r.account_id === accountId)) {
        await tx.table('video_posts').delete(row.id)
        // The payload is the row as it stood, so a stuck entry can say what it
        // was going to remove rather than only naming an id.
        this.enqueue(tx, 'video_posts', row.id, 'delete', row)
      }
    })
  }

  async listVideoPosts(videoId: string): Promise<VideoPost[]> {
    return this.db.video_posts.where('video_id').equals(videoId).toArray()
  }

  async setViewCount(videoPostId: string, viewCount: number): Promise<VideoPost> {
    return this.tx([this.db.video_posts, this.db._outbox], async (tx) => {
      const existing = (await this.requireRow(tx, 'video_posts', videoPostId)) as VideoPost
      const row: VideoPost = {
        ...existing,
        view_count: viewCount,
        // Stamped so a bonus can be judged against how stale the number is.
        view_count_entered_at: now(),
        updated_at: now(),
      }
      assertRow('video_posts', row)
      await tx.table('video_posts').put(row)
      this.enqueue(tx, 'video_posts', row.id, 'update', row)
      return row
    })
  }

  // --- History -----------------------------------------------------------

  async listPhaseEvents(filter?: { videoId?: string; since?: string }): Promise<PhaseEvent[]> {
    let rows: PhaseEvent[]
    if (filter?.videoId) {
      rows = await this.db.phase_events.where('video_id').equals(filter.videoId).toArray()
    } else if (filter?.since) {
      rows = await this.db.phase_events.where('occurred_at').aboveOrEqual(filter.since).toArray()
    } else {
      rows = await this.db.phase_events.toArray()
    }
    if (filter?.videoId && filter.since) {
      rows = rows.filter((e) => e.occurred_at >= filter.since!)
    }
    return rows.sort((a, b) => a.id - b.id)
  }

  // --- Warm-up -------------------------------------------------------------

  async listWarmupEvents(filter?: { campaignId?: string }): Promise<WarmupEvent[]> {
    const rows = filter?.campaignId
      ? await this.db.warmup_events.where('campaign_id').equals(filter.campaignId).toArray()
      : await this.db.warmup_events.toArray()
    return rows.sort((a, b) => a.id - b.id)
  }

  async recordWarmupEvent(accountId: string, minutes: number): Promise<WarmupEvent> {
    return this.tx(
      [this.db.warmup_events, this.db.campaign_accounts, this.db.campaigns, this.db._outbox],
      async (tx) => {
        const account = (await this.requireRow(
          tx,
          'campaign_accounts',
          accountId,
        )) as CampaignAccount

        // No `id` field: Dexie's ++id only auto-assigns when the key is absent,
        // not when it is present at any value - same as the phase_event insert
        // in createVideo above.
        const draft = {
          user_id: this.userId,
          // Resolved from the account so the two can never disagree.
          campaign_id: account.campaign_id,
          account_id: account.id,
          minutes,
          occurred_at: now(),
          // Client-minted so a retried push lands exactly once - see
          // phase_events.client_id for why.
          client_id: newId(),
        }
        const id = await tx.table('warmup_events').add(draft)
        const saved: WarmupEvent = { ...draft, id: id as number }
        this.enqueue(tx, 'warmup_events', String(saved.id), 'insert', saved)

        // Promote once he has done enough of them. Counted from the log rather
        // than incremented, so the status and its evidence cannot drift.
        const events = (await tx.table('warmup_events').toArray()) as WarmupEvent[]
        const status = statusAfterWarmup(account, warmupCompletions(account.id, events))
        if (status !== account.status) {
          const updated: CampaignAccount = { ...account, status, updated_at: now() }
          assertRow('campaign_accounts', updated)
          await tx.table('campaign_accounts').put(updated)
          this.enqueue(tx, 'campaign_accounts', updated.id, 'update', updated)
        }

        return saved
      },
    )
  }

  // --- Accounts ----------------------------------------------------------

  async listCampaignAccounts(campaignId?: string): Promise<CampaignAccount[]> {
    const rows = campaignId
      ? await this.db.campaign_accounts.where('campaign_id').equals(campaignId).toArray()
      : await this.db.campaign_accounts.toArray()
    return rows
      .filter((row) => row.is_active)
      .sort((a, b) => a.sort_order - b.sort_order || a.platform.localeCompare(b.platform))
  }

  async addCampaignAccount(account: NewCampaignAccount): Promise<CampaignAccount> {
    const timestamp = now()
    const row: CampaignAccount = {
      id: account.id ?? newId(),
      user_id: this.userId,
      campaign_id: account.campaign_id,
      platform: account.platform,
      handle: account.handle,
      email: account.email ?? null,
      password: account.password ?? null,
      posts_per_day: account.posts_per_day ?? 0,
      // New until he says otherwise: an account nobody has warmed up is not
      // one to post brand content from.
      status: account.status ?? 'new',
      is_active: account.is_active ?? true,
      sort_order: account.sort_order ?? 0,
      created_at: account.created_at ?? timestamp,
      updated_at: account.updated_at ?? timestamp,
    }
    assertRow('campaign_accounts', row)

    await this.tx([this.db.campaign_accounts, this.db.campaigns, this.db._outbox], async (tx) => {
      await this.requireRow(tx, 'campaigns', row.campaign_id)
      // The SQL's unique (campaign_id, platform). Dexie enforces it too, but
      // the message it throws is not one anybody could act on.
      const clash = await tx
        .table('campaign_accounts')
        .where('[campaign_id+platform]')
        .equals([row.campaign_id, row.platform])
        .first()
      if (clash) throw new DataError(`This campaign already has a ${row.platform} account.`)

      await tx.table('campaign_accounts').add(row)
      this.enqueue(tx, 'campaign_accounts', row.id, 'insert', row)
    })
    return row
  }

  async updateCampaignAccount(
    id: string,
    patch: Partial<Omit<CampaignAccount, 'id' | 'user_id' | 'campaign_id'>>,
  ): Promise<CampaignAccount> {
    return this.tx([this.db.campaign_accounts, this.db._outbox], async (tx) => {
      const existing = (await this.requireRow(tx, 'campaign_accounts', id)) as CampaignAccount
      const row: CampaignAccount = { ...existing, ...patch, updated_at: now() }
      assertRow('campaign_accounts', row)
      await tx.table('campaign_accounts').put(row)
      this.enqueue(tx, 'campaign_accounts', row.id, 'update', row)
      return row
    })
  }

  /** Soft delete. The row stays so that video_posts pointing at it still say
   *  which account they went out from - a hard delete would leave a posted
   *  video unable to answer where it was posted. */
  async deleteCampaignAccount(id: string): Promise<void> {
    await this.updateCampaignAccount(id, { is_active: false })
  }

  // --- Work sessions -----------------------------------------------------

  async listWorkSessions(filter?: {
    campaignId?: string
    openOnly?: boolean
  }): Promise<WorkSession[]> {
    let rows = filter?.campaignId
      ? await this.db.work_sessions.where('campaign_id').equals(filter.campaignId).toArray()
      : await this.db.work_sessions.toArray()

    if (filter?.openOnly) rows = rows.filter((row) => row.ended_at === null)
    return rows.sort((a, b) => b.started_at.localeCompare(a.started_at))
  }

  async startWorkSession(session: NewWorkSession): Promise<WorkSession> {
    const timestamp = now()
    const row: WorkSession = {
      id: session.id ?? newId(),
      user_id: this.userId,
      campaign_id: session.campaign_id,
      kind: session.kind,
      goal_videos: session.goal_videos,
      planned_minutes: session.planned_minutes,
      started_at: session.started_at ?? timestamp,
      ended_at: session.ended_at ?? null,
      created_at: session.created_at ?? timestamp,
      updated_at: session.updated_at ?? timestamp,
    }
    assertRow('work_sessions', row)

    await this.tx([this.db.work_sessions, this.db.campaigns, this.db._outbox], async (tx) => {
      await this.requireRow(tx, 'campaigns', row.campaign_id)
      await tx.table('work_sessions').add(row)
      this.enqueue(tx, 'work_sessions', row.id, 'insert', row)
    })
    return row
  }

  async endWorkSession(id: string): Promise<WorkSession> {
    return this.tx([this.db.work_sessions, this.db._outbox], async (tx) => {
      const existing = (await this.requireRow(tx, 'work_sessions', id)) as WorkSession
      // Already finished. A reopened tab must not extend an evening that ended.
      if (existing.ended_at !== null) return existing

      const row: WorkSession = { ...existing, ended_at: now(), updated_at: now() }
      assertRow('work_sessions', row)
      await tx.table('work_sessions').put(row)
      this.enqueue(tx, 'work_sessions', row.id, 'update', row)
      return row
    })
  }

  // --- Hooks -------------------------------------------------------------

  async listCampaignHooks(
    campaignId: string,
    filter?: { unusedOnly?: boolean },
  ): Promise<CampaignHook[]> {
    const rows = await this.db.campaign_hooks.where('campaign_id').equals(campaignId).toArray()
    const kept = filter?.unusedOnly ? rows.filter((row) => row.used_at === null) : rows
    return kept.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  async addCampaignHook(hook: NewCampaignHook): Promise<CampaignHook> {
    const timestamp = now()
    const row: CampaignHook = {
      id: hook.id ?? newId(),
      user_id: this.userId,
      campaign_id: hook.campaign_id,
      angle_id: hook.angle_id,
      body: hook.body,
      outline: hook.outline,
      source: hook.source,
      model: hook.model,
      generated_at: hook.generated_at,
      used_at: hook.used_at,
      created_at: hook.created_at ?? timestamp,
      updated_at: hook.updated_at ?? timestamp,
    }
    // The check constraints carry the honesty rule here: a generated hook has
    // to name the model that wrote it, and one he typed cannot claim a model.
    assertRow('campaign_hooks', row)

    await this.tx([this.db.campaign_hooks, this.db.campaigns, this.db._outbox], async (tx) => {
      await this.requireRow(tx, 'campaigns', row.campaign_id)
      await tx.table('campaign_hooks').add(row)
      this.enqueue(tx, 'campaign_hooks', row.id, 'insert', row)
    })
    return row
  }

  /** Deletes a hook outright.
   *
   *  Hooks are the one thing on the brief page that is genuinely disposable:
   *  a line he did not like, or a generated batch he has finished with. There
   *  is no history to preserve - a hook is not an event, it is material - so
   *  this is a real delete rather than the soft delete accounts use. */
  async deleteCampaignHook(id: string): Promise<void> {
    await this.tx([this.db.campaign_hooks, this.db._outbox], async (tx) => {
      const existing = (await tx.table('campaign_hooks').get(id)) as CampaignHook | undefined
      if (!existing) return
      await tx.table('campaign_hooks').delete(id)
      this.enqueue(tx, 'campaign_hooks', id, 'delete', existing)
    })
  }

  async setHookUsed(id: string, used: boolean): Promise<CampaignHook> {
    return this.tx([this.db.campaign_hooks, this.db._outbox], async (tx) => {
      const existing = (await this.requireRow(tx, 'campaign_hooks', id)) as CampaignHook
      const row: CampaignHook = {
        ...existing,
        used_at: used ? (existing.used_at ?? now()) : null,
        updated_at: now(),
      }
      assertRow('campaign_hooks', row)
      await tx.table('campaign_hooks').put(row)
      this.enqueue(tx, 'campaign_hooks', row.id, 'update', row)
      return row
    })
  }

  // --- Money -------------------------------------------------------------

  async listBonusTiers(campaignId: string): Promise<BonusTier[]> {
    const rows = await this.db.bonus_tiers.where('campaign_id').equals(campaignId).toArray()
    return rows.sort((a, b) => a.threshold_views - b.threshold_views)
  }

  async addBonusTier(tier: NewBonusTier): Promise<BonusTier> {
    const row: BonusTier = {
      id: tier.id ?? newId(),
      user_id: this.userId,
      campaign_id: tier.campaign_id,
      label: tier.label,
      threshold_views: tier.threshold_views,
      payout_cents: tier.payout_cents,
      view_window_days: tier.view_window_days,
      updated_at: now(),
    }
    assertRow('bonus_tiers', row)

    await this.tx([this.db.bonus_tiers,
      this.db.campaigns,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'campaigns', row.campaign_id)
        await tx.table('bonus_tiers').add(row)
        this.enqueue(tx, 'bonus_tiers', row.id, 'insert', row)
      })
    return row
  }

  async listBonusClaims(filter?: { videoId?: string }): Promise<BonusClaim[]> {
    if (filter?.videoId) {
      return this.db.bonus_claims.where('video_id').equals(filter.videoId).toArray()
    }
    return this.db.bonus_claims.toArray()
  }

  /** Upsert the claim row for (video, tier), creating it at probability 0 if
   *  it does not exist yet. */
  private async claimFor(
    tx: Transaction,
    videoId: string,
    bonusTierId: string,
  ): Promise<BonusClaim> {
    const existing = (await tx
      .table('bonus_claims')
      .where('[video_id+bonus_tier_id]')
      .equals([videoId, bonusTierId])
      .first()) as BonusClaim | undefined
    if (existing) return existing

    return {
      id: newId(),
      user_id: this.userId,
      video_id: videoId,
      bonus_tier_id: bonusTierId,
      // Defaults to zero so the EXPECTED column reads $0 until he judges it.
      probability: 0,
      received_cents: null,
      received_at: null,
      updated_at: now(),
    }
  }

  async setBonusProbability(
    videoId: string,
    bonusTierId: string,
    probability: number,
  ): Promise<BonusClaim> {
    return this.tx([this.db.bonus_claims,
      this.db.videos,
      this.db.bonus_tiers,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'videos', videoId)
        await this.requireRow(tx, 'bonus_tiers', bonusTierId)
        const existing = await this.claimFor(tx, videoId, bonusTierId)
        const row: BonusClaim = { ...existing, probability, updated_at: now() }
        assertRow('bonus_claims', row)
        await tx.table('bonus_claims').put(row)
        this.enqueue(tx, 'bonus_claims', row.id, 'update', row)
        return row
      })
  }

  async recordBonusReceived(
    videoId: string,
    bonusTierId: string,
    receivedCents: number,
    receivedAt: string,
  ): Promise<BonusClaim> {
    return this.tx([this.db.bonus_claims,
      this.db.videos,
      this.db.bonus_tiers,
      this.db._outbox], async (tx) => {
        await this.requireRow(tx, 'videos', videoId)
        await this.requireRow(tx, 'bonus_tiers', bonusTierId)
        const existing = await this.claimFor(tx, videoId, bonusTierId)
        const row: BonusClaim = {
          ...existing,
          received_cents: receivedCents,
          received_at: receivedAt,
          updated_at: now(),
        }
        assertRow('bonus_claims', row)
        await tx.table('bonus_claims').put(row)
        this.enqueue(tx, 'bonus_claims', row.id, 'update', row)
        return row
      })
  }

  // --- Settings ----------------------------------------------------------

  async getUserSettings(): Promise<UserSettings> {
    const existing = await this.db.user_settings.get(this.userId)
    if (existing) return existing

    const row: UserSettings = {
      user_id: this.userId,
      setup_switch_minutes: DEFAULT_SETUP_SWITCH_MINUTES,
      // Ships null on purpose. The runway figure depends on the filmed-but-
      // unedited count, and a seeded guess would be indistinguishable from a
      // real one he had entered.
      opening_unedited_count: null,
      last_export_at: null,
      updated_at: now(),
    }
    assertRow('user_settings', row)
    await this.tx([this.db.user_settings, this.db._outbox], async (tx) => {
      await tx.table('user_settings').put(row)
      this.enqueue(tx, 'user_settings', row.user_id, 'insert', row)
    })
    return row
  }

  async updateUserSettings(patch: Partial<Omit<UserSettings, 'user_id'>>): Promise<UserSettings> {
    const current = await this.getUserSettings()
    return this.tx([this.db.user_settings, this.db._outbox], async (tx) => {
      const row: UserSettings = { ...current, ...patch, updated_at: now() }
      assertRow('user_settings', row)
      await tx.table('user_settings').put(row)
      this.enqueue(tx, 'user_settings', row.user_id, 'update', row)
      return row
    })
  }

  async listTimeEstimates(): Promise<TimeEstimate[]> {
    const existing = await this.db.time_estimates.toArray()
    if (existing.length > 0) return existing

    // Seed the EST values from SPEC section 9 on first run. These are the
    // spec's own starting estimates, not measurements and not campaign data,
    // and every one of them is editable.
    const seeded: TimeEstimate[] = DEFAULT_TIME_ESTIMATES.map((e) => ({
      id: newId(),
      user_id: this.userId,
      ...e,
      updated_at: now(),
    }))
    for (const row of seeded) assertRow('time_estimates', row)

    await this.tx([this.db.time_estimates, this.db._outbox], async (tx) => {
      await tx.table('time_estimates').bulkAdd(seeded)
      for (const row of seeded) this.enqueue(tx, 'time_estimates', row.id, 'insert', row)
    })
    return seeded
  }

  async upsertTimeEstimate(estimate: Omit<TimeEstimate, 'id' | 'user_id'>): Promise<TimeEstimate> {
    await this.listTimeEstimates() // make sure the defaults exist first
    return this.tx([this.db.time_estimates, this.db._outbox], async (tx) => {
      const existing = (await tx
        .table('time_estimates')
        .where('[user_id+setup]')
        .equals([this.userId, estimate.setup])
        .first()) as TimeEstimate | undefined

      const row: TimeEstimate = {
        id: existing?.id ?? newId(),
        user_id: this.userId,
        ...estimate,
      }
      assertRow('time_estimates', row)
      await tx.table('time_estimates').put(row)
      this.enqueue(tx, 'time_estimates', row.id, existing ? 'update' : 'insert', row)
      return row
    })
  }

  // --- Backup ------------------------------------------------------------

  async exportAll(): Promise<BackupSnapshot> {
    const [
      campaigns,
      campaign_accounts,
      campaign_documents,
      campaign_fields,
      campaign_angles,
      campaign_hooks,
      campaign_rules,
      videos,
      video_posts,
      phase_events,
      work_sessions,
      warmup_events,
      bonus_tiers,
      bonus_claims,
      time_estimates,
      user_settings,
    ] = await Promise.all([
      this.db.campaigns.toArray(),
      this.db.campaign_accounts.toArray(),
      this.db.campaign_documents.toArray(),
      this.db.campaign_fields.toArray(),
      this.db.campaign_angles.toArray(),
      this.db.campaign_hooks.toArray(),
      this.db.campaign_rules.toArray(),
      this.db.videos.toArray(),
      this.db.video_posts.toArray(),
      this.db.phase_events.toArray(),
      this.db.work_sessions.toArray(),
      this.db.warmup_events.toArray(),
      this.db.bonus_tiers.toArray(),
      this.db.bonus_claims.toArray(),
      this.db.time_estimates.toArray(),
      this.db.user_settings.toArray(),
    ])

    return {
      format_version: BACKUP_FORMAT_VERSION,
      exported_at: now(),
      campaigns,
      campaign_accounts,
      campaign_documents,
      campaign_fields,
      campaign_angles,
      campaign_hooks,
      campaign_rules,
      videos,
      video_posts,
      phase_events,
      work_sessions,
      warmup_events,
      bonus_tiers,
      bonus_claims,
      time_estimates,
      user_settings,
    }
  }

  async importAll(snapshot: unknown): Promise<ImportResult> {
    const parsed = parseSnapshot(snapshot)

    // Validate everything before writing anything. A snapshot that fails on
    // its last row must leave the store exactly as it was - this is the backup
    // of record, and a half-applied restore is worse than a refused one.
    const counts: Record<string, number> = {}
    for (const table of MIRRORED_TABLES) {
      const rows = parsed[table] as unknown[]
      rows.forEach((row, i) => {
        try {
          assertRow(table, row as never)
        } catch (error) {
          const detail = error instanceof ConstraintError ? error.message : String(error)
          throw new DataError(`${table}[${i}] is not a valid row: ${detail}`)
        }
      })
      counts[table] = rows.length
    }

    await this.tx([...MIRRORED_TABLES.map((t) => this.db.table(t)), this.db._outbox], async (tx) => {
        for (const table of MIRRORED_TABLES) {
          await tx.table(table).clear()
          await tx.table(table).bulkAdd(parsed[table] as never[])
        }
        // Anything queued described rows that no longer exist.
        await tx.table('_outbox').clear()
      })

    return { counts }
  }

  // --- The outbox --------------------------------------------------------

  async listPendingWrites(limit?: number): Promise<PendingWrite[]> {
    // Oldest first: the server is told things in the order they happened, so a
    // create always reaches it before the update that follows it.
    const all = (await this.db._outbox.orderBy('id').toArray()) as OutboxEntry[]
    const pending = limit === undefined ? all : all.slice(0, limit)
    return pending.map((entry) => ({
      id: entry.id,
      table_name: entry.table_name,
      row_id: entry.row_id,
      op: entry.op,
      payload: entry.payload,
      queued_at: entry.queued_at,
      attempts: entry.attempts,
      last_error: entry.last_error ?? null,
    }))
  }

  async markWriteSynced(id: number): Promise<void> {
    await this.db._outbox.delete(id)
  }

  async markWriteFailed(id: number, reason: string): Promise<void> {
    const entry = await this.db._outbox.get(id)
    if (!entry) return
    // Stays queued. A failed push is a thing the server has not been told yet,
    // which is exactly what the queue is for.
    await this.db._outbox.put({ ...entry, attempts: entry.attempts + 1, last_error: reason })
  }

  async applyRemoteRow(table: TableName, row: unknown): Promise<void> {
    assertRow(table, row as never)
    // No enqueue: this came from the server, and sending it straight back
    // would be an echo that never settles.
    await this.db.table(table).put(row)
  }

  /** The current owner of every local row. */
  currentUserId(): string {
    return this.userId
  }

  async backfillOutbox(): Promise<number> {
    let queued = 0

    await this.tx(
      [...MIRRORED_TABLES.map((t) => this.db.table(t)), this.db._outbox],
      async (tx) => {
        for (const table of MIRRORED_TABLES) {
          const rows = (await tx.table(table).toArray()) as {
            user_id: string
            id?: string | number
          }[]

          for (const row of rows) {
            // Another account's rows are not this device's to push.
            if (row.user_id !== this.userId) continue

            // Append-only tables insert and are deduplicated by client_id;
            // everything else upserts, so an update carries a row the server
            // has never seen just as well as one it has.
            const op =
              table === 'phase_events' || table === 'warmup_events' ? 'insert' : 'update'
            const rowId = table === 'user_settings' ? this.userId : String(row.id ?? '')

            this.enqueue(tx, table, rowId, op, row)
            queued++
          }
        }
      },
    )

    return queued
  }

  async claimRowsForUser(userId: string): Promise<ClaimResult> {
    const previousUserId = this.userId
    if (previousUserId === userId) {
      // Already claimed. Doing it again would be a no-op at best and, if
      // the id had drifted, a way to split the data between two owners.
      return { claimed: false, rowsClaimed: 0, pendingWritesRewritten: 0, previousUserId }
    }

    let rowsClaimed = 0
    let pendingWritesRewritten = 0

    await this.tx(
      [...MIRRORED_TABLES.map((t) => this.db.table(t)), this.db._outbox],
      async (tx) => {
        for (const table of MIRRORED_TABLES) {
          const rows = (await tx.table(table).toArray()) as {
            user_id: string
            id?: string
          }[]

          for (const row of rows) {
            if (row.user_id !== previousUserId) continue
            const claimedRow = { ...row, user_id: userId }

            if (table === "user_settings") {
              // Keyed by user_id, so this is a move rather than an edit.
              await tx.table(table).delete(previousUserId)
              await tx.table(table).add(claimedRow)
            } else {
              await tx.table(table).put(claimedRow)
            }

            rowsClaimed++
            // phase_events and warmup_events are insert-only; the server has
            // never seen any of this, because sync does not run before sign-in.
            const op =
              table === "phase_events" || table === "warmup_events" ? "insert" : "update"
            const rowId =
              table === "user_settings" ? userId : (claimedRow.id ?? "")
            this.enqueue(tx, table, String(rowId), op, claimedRow)
          }
        }

        // Entries queued before sign-in still name the old owner. Left
        // alone they would reach the server and be refused by RLS.
        const queued = (await tx.table("_outbox").toArray()) as OutboxEntry[]
        for (const entry of queued) {
          const payload = entry.payload as { user_id?: string } | null
          if (!payload || payload.user_id !== previousUserId) continue
          await tx.table("_outbox").put({
            ...entry,
            payload: { ...payload, user_id: userId },
            row_id: entry.table_name === "user_settings" ? userId : entry.row_id,
          })
          pendingWritesRewritten++
        }
      },
    )

    // Only after the rows are committed. If the transaction had failed, the
    // adapter would still be pointing at the id its rows actually carry.
    this.userId = userId
    try {
      localStorage.setItem(USER_ID_KEY, userId)
    } catch {
      // Storage blocked. The rows are claimed either way; the next run just
      // mints a fresh local id and claims again on sign-in.
    }

    return { claimed: true, rowsClaimed, pendingWritesRewritten, previousUserId }
  }

  async reset(scope: ResetScope): Promise<void> {
    if (scope === 'everything') {
      await this.tx([...MIRRORED_TABLES.map((t) => this.db.table(t)), this.db._outbox], async (tx) => {
          for (const table of MIRRORED_TABLES) await tx.table(table).clear()
          await tx.table('_outbox').clear()
        })
      return
    }

    // 'today': discard today's plan without touching history, the ledger or
    // anything he actually worked on. Only videos owed for today that have
    // never moved - one phase_event, the creation row - are removed.
    //
    // NOTE: the spec says only "today only / everything", so which rows a
    // today-reset should take is an assumption, not a documented rule. This is
    // the conservative reading: it cannot destroy work or money.
    const today = localToday()
    await this.tx([this.db.videos,
      this.db.phase_events,
      this.db._outbox], async (tx) => {
        const todays = (await tx
          .table('videos')
          .where('owed_for_date')
          .equals(today)
          .toArray()) as Video[]

        for (const video of todays) {
          const events = await tx.table('phase_events').where('video_id').equals(video.id).count()
          if (events > 1) continue // he moved it; it is not just a plan any more
          if (video.phase === 'posted') continue // never touch the ledger
          await tx.table('videos').delete(video.id)
          await tx.table('phase_events').where('video_id').equals(video.id).delete()
        }
      })
  }
}

export const BACKUP_FORMAT_VERSION = 1

/** Validates the envelope of an imported snapshot. Row-level validation is the
 *  caller's next step; this only establishes that there are arrays to check. */
function parseSnapshot(snapshot: unknown): Record<TableName, unknown[]> {
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new DataError('import: expected a JSON object')
  }
  const record = snapshot as Record<string, unknown>

  const version = record.format_version
  if (version !== BACKUP_FORMAT_VERSION) {
    throw new DataError(
      `import: this backup is format version ${String(version)}, and this build reads version ${BACKUP_FORMAT_VERSION}`,
    )
  }

  const out = {} as Record<TableName, unknown[]>
  for (const table of MIRRORED_TABLES) {
    const rows = record[table]
    if (rows === undefined) {
      // A table absent from the snapshot restores as empty rather than
      // failing: an older export is still a usable backup.
      out[table] = []
      continue
    }
    if (!Array.isArray(rows)) throw new DataError(`import: ${table} must be an array`)
    out[table] = rows
  }
  return out
}
