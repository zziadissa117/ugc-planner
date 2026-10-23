// What a failed write says on screen.
//
// Dexie's own words for a broken unique index - "A mutation operation in the
// transaction failed because a constraint was not satisfied. For example, an
// object such as an object store or index already exists..." - were shown to
// him verbatim under a Save button. Red is allowed to say what is blocked,
// in words he can act on.

export function plainError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'ConstraintError' && /mutation operation|constraint was not satisfied/i.test(message)) {
    return 'Two of these rows clash - the same thing twice (a bonus threshold, a platform, a field). Nothing was saved. Take one out and save again.'
  }
  if (name === 'QuotaExceededError') {
    return 'This device is out of storage space, so nothing could be saved. Free some space and try again.'
  }
  return message
}

/** True for a failure in the app's own data layer - a rule refused the row,
 *  a row named something that does not exist - as opposed to the network,
 *  which looks after itself. */
export function isDataFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'ConstraintError' || error.name === 'DataError'
}
