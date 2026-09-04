import type { CampaignField } from '../data'

/** Renders one field with its provenance visible.
 *
 *  Colour carries state only:
 *    documented        - plain, with a DOCUMENTED label. Backed by a quote.
 *    user_entered      - plain, with a USER ENTERED label. His word for it.
 *    parsed_unreviewed - amber. A machine read it and nobody has checked it.
 *    missing           - grey "not saved yet". Known to be absent.
 *
 *  The labels matter more than they look: "documented rate" is a claim about a
 *  contract, and it must not be possible to confuse it with a number someone
 *  typed. */
export function FieldValue({ field }: { field: CampaignField }) {
  if (field.source === 'missing') {
    return <span className="text-state-later">not saved yet</span>
  }

  if (field.source === 'parsed_unreviewed') {
    return (
      <span className="text-state-waiting">
        {field.field_value}
        <span className="ml-2 text-xs font-semibold uppercase tracking-wide">
          from file - unreviewed
        </span>
      </span>
    )
  }

  return (
    <span className="text-text">
      {field.field_value}
      <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-state-later">
        {field.source === 'documented' ? 'documented' : 'user entered'}
      </span>
    </span>
  )
}
