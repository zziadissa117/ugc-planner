// One signal for "rows changed underneath the screens".
//
// Screens read their rows once (useLoaded) and again after their own writes.
// Two things write without a screen knowing: the cutter bridge ticking posts
// every few minutes, and a sync pull bringing another device's edits. Until
// now neither told anyone, so the count he reads across the room stayed
// stale until he tapped - and a box the bridge had already ticked could be
// tapped again. Anything that writes behind the screens announces it here,
// and every useLoaded screen reads again.

export const DATA_CHANGED_EVENT = 'ugc-planner:data-changed'

export function announceDataChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
}
