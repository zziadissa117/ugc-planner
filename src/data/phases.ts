// The phase chains, from SPEC section 3.
//
// A video's chain depends on its campaign's approval_mode - except for warm-up
// videos, which never submit to anyone regardless of what the campaign's paid
// work requires. Warm-up content carries no brand mention at all, so there is
// nothing for a brand to approve.

import type { ApprovalMode, VideoKind, VideoPhase } from './schema'

const CHAINS: Record<ApprovalMode, readonly VideoPhase[]> = {
  none: ['to_film', 'filmed', 'edited', 'posted'],
  video: ['to_film', 'filmed', 'edited', 'submitted', 'approved', 'posted'],
  script_and_video: [
    'awaiting_script_approval',
    'to_film',
    'filmed',
    'edited',
    'submitted',
    'approved',
    'posted',
  ],
  // The brand writes the script, so the wait is for the brief rather than for
  // approval of his own. It still submits, but posts straight after.
  brand_scripted: ['awaiting_brief', 'to_film', 'filmed', 'edited', 'submitted', 'posted'],
}

/** Warm-up never submits and never gets approved: nobody is reviewing content
 *  that does not mention the brand. */
const WARM_UP_CHAIN: readonly VideoPhase[] = ['to_film', 'filmed', 'edited', 'posted']

export function chainFor(approvalMode: ApprovalMode, kind: VideoKind): readonly VideoPhase[] {
  return kind === 'warm_up' ? WARM_UP_CHAIN : CHAINS[approvalMode]
}

/** The phase after this one, or null at the end of the chain. */
export function nextPhase(
  phase: VideoPhase,
  approvalMode: ApprovalMode,
  kind: VideoKind,
): VideoPhase | null {
  const chain = chainFor(approvalMode, kind)
  const i = chain.indexOf(phase)
  if (i === -1 || i === chain.length - 1) return null
  return chain[i + 1]
}

/** The phase before this one, or null at the start. Backs the undo tap: he
 *  advances a row by mistake with his thumb and taps again to put it back. */
export function previousPhase(
  phase: VideoPhase,
  approvalMode: ApprovalMode,
  kind: VideoKind,
): VideoPhase | null {
  const chain = chainFor(approvalMode, kind)
  const i = chain.indexOf(phase)
  if (i <= 0) return null
  return chain[i - 1]
}

/** Which stage of the pipeline a session works on. An evening is a pass over
 *  one stage, so a FILM session only ever considers videos needing filming. */
export const SESSION_TARGET_PHASE = {
  film: 'to_film',
  edit: 'filmed',
  post: 'approved',
  // A warm-up session films new warm-up content.
  warm_up: 'to_film',
} as const satisfies Record<string, VideoPhase>
