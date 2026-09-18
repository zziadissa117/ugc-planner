// Durable storage for the silence-cutter's queue, so a video he just added
// survives whatever happens to the tab before it's processed.
//
// Why this exists: the queue used to live only in React state. Two things can
// make a tab reload without any action of his - the PWA's own service worker
// updating in the background (this app auto-updates, and every deploy today
// was exactly that), and iOS reclaiming a Safari tab's memory while its own
// native picker sheet is busy preparing several large videos at once, which
// is a known rough edge with picking many big videos together. Either one
// looks identical from where he's sitting: "I added it, and after it loads,
// it's gone." A reload should never be able to lose a video he already
// picked, so the queue is written to IndexedDB the moment a file is added,
// not only held in memory.
//
// A separate database from the main app's on purpose - this is processing
// state for a local tool, not campaign data, and has no reason to go near
// docs/schema.sql or the sync engine. Nothing outside src/media imports this.

import Dexie, { type EntityTable } from 'dexie'

/** What a queued job needs to resume after a reload. Not the whole `Job`
 *  shape in CutSilence.tsx - only what can't be recomputed: the file itself,
 *  its name, and the settings it was queued with. */
interface StoredJob {
  id: string
  fileBlob: Blob
  fileName: string
  fileType: string
  settings: { thresholdDb: number; minSilenceSec: number; paddingSec: number }
  detectFillerWords: boolean
  addedAt: number
}

const db = new Dexie('silence-cutter-queue') as Dexie & {
  jobs: EntityTable<StoredJob, 'id'>
}
db.version(1).stores({ jobs: 'id, addedAt' })

export async function persistJob(job: Omit<StoredJob, 'addedAt'>): Promise<void> {
  await db.jobs.put({ ...job, addedAt: Date.now() })
}

export async function forgetJob(id: string): Promise<void> {
  await db.jobs.delete(id)
}

/** Every job that never finished - because the tab reloaded, was closed, or
 *  the process was killed while it was still queued or in progress. Oldest
 *  first, so they resume in the order they were added. */
export async function loadPendingJobs(): Promise<Array<StoredJob & { file: File }>> {
  const rows = await db.jobs.orderBy('addedAt').toArray()
  return rows.map((row) => ({
    ...row,
    file: new File([row.fileBlob], row.fileName, { type: row.fileType }),
  }))
}
