// Claiming local rows for a real account, on first sign-in.
//
// Before sign-in there is no auth.uid(), but user_id is NOT NULL on every table
// and the local store mirrors the schema exactly. So rows are minted with a
// local id from localStorage. The moment an account exists, every one of them
// has to be reassigned to it.
//
// Getting this wrong is the worst failure in the app: RLS refuses rows whose
// user_id is not auth.uid(), and a refused push looks from the outside exactly
// like a successful one with nothing to send. The first sync would report
// success and upload nothing, and he would find out when he lost a device.

import type { ClaimResult, DataAdapter } from '../data'

/** Just enough of the auth layer to be swapped for a fake in tests. The real
 *  one is `getAuthState` in ./auth; the tests here supply their own, so the
 *  logic is exercised for real rather than mocked away. */
export interface AuthLike {
  getAuthState(): Promise<{ userId: string | null }>
}

export type ClaimOutcome =
  | { status: 'claimed'; result: ClaimResult }
  /** The rows already belong to this account. */
  | { status: 'already-claimed'; result: ClaimResult }
  /** Nobody is signed in, so there is nothing to claim for. Not an error: the
   *  app is local-first and this is its normal state. */
  | { status: 'signed-out' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function claimLocalRows(
  adapter: DataAdapter,
  auth: AuthLike,
): Promise<ClaimOutcome> {
  const { userId } = await auth.getAuthState()
  if (userId === null) return { status: 'signed-out' }

  if (!UUID.test(userId)) {
    // Every user_id column is a uuid. Writing something else would produce rows
    // the server could never accept, discovered only at the first push.
    throw new Error(`Refusing to claim rows for a non-uuid account id: ${userId}`)
  }

  const result = await adapter.claimRowsForUser(userId)
  return result.claimed
    ? { status: 'claimed', result }
    : { status: 'already-claimed', result }
}
