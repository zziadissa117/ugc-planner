// The one owner gate for the planner's own server functions.
//
// The planner is shared with other people, but some things it can do are his
// alone: reading a PDF costs far more tokens than a pasted Markdown file, and
// anything that touches the cutter's tables or his Postiz key is private.
// Every such function asks this, and only this, so "who is the owner" has one
// answer.
//
// PLANNER_ADMIN_USER_IDS is a comma-separated list of auth user ids. Until it
// is set, CUTTER_BRIDGE_USER_IDS stands in: it already lists exactly his ids
// for the cutter bridge (cutter-posted), so the gate works without a second
// secret to keep in step.

function listFrom(name: string): string[] {
  return (Deno.env.get(name) ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function ownerIds(): string[] {
  const admins = listFrom('PLANNER_ADMIN_USER_IDS')
  return admins.length > 0 ? admins : listFrom('CUTTER_BRIDGE_USER_IDS')
}

/** True only for an id on the owner list. The id must come from the verified
 *  session (requireUser), never from the request body. */
export function isOwner(userId: string): boolean {
  return ownerIds().includes(userId)
}
