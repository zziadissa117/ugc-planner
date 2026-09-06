// The phase chains, from SPEC section 3.
//
// A video's chain depends on its campaign's approval_mode - except for warm-up
// videos, which never submit to anyone regardless of what the campaign's paid
// work requires. Warm-up content carries no brand mention at all, so there is
// nothing for a brand to approve.

import type { ApprovalMode, VideoKind, VideoPhase } from './schema'

/** The chain. One, for every campaign and every kind of video.
 *
 *  It used to branch on approval_mode, and the approval-gated branches ran
 *  `filmed -> edited -> submitted -> approved -> posted`. Nothing in the app
 *  ever targeted `submitted` or `approved`: no screen listed them, no tap
 *  moved them. Videos walked as far as `edited` and stopped there for good -
 *  which is why POST sessions were always empty, runway was always 0 and the
 *  ledger never moved. A brand's approval happens in SideShift and WhatsApp,
 *  and the app was never told about it, so it has no business modelling it as
 *  a phase a video sits in.
 *
 *  `approval_mode` is still on the campaign and still says what the contract
 *  requires. It just no longer decides the chain. */
export const CHAIN: readonly VideoPhase[] = ['to_film', 'filmed', 'edited', 'posted']

/** Kept taking both arguments so every caller reads the same, and so the
 *  campaign's approval route stays visible at the call site. Neither changes
 *  the answer any more. */
export function chainFor(_approvalMode: ApprovalMode, _kind: VideoKind): readonly VideoPhase[] {
  return CHAIN
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
  // Edited and waiting to go out. This was 'approved', a phase most campaigns
  // never had and nothing ever moved a video into, so a POST session could
  // only ever find an empty list.
  post: 'edited',
  // A warm-up session films new warm-up content.
  warm_up: 'to_film',
} as const satisfies Record<string, VideoPhase>
