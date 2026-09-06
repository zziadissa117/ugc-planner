import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  // Each test gets a fresh IndexedDB, so it must get fresh localStorage too.
  // The app keeps small client-side markers there - the sync cursor, the
  // outbox backfill flag, whether the seed has run - and a marker left behind
  // by one test silently changes what the next one does.
  try {
    localStorage.clear()
  } catch {
    /* storage unavailable in this environment */
  }
})

afterEach(() => {
  cleanup()
})
