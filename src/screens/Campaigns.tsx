import { Link } from 'react-router-dom'

import { Placeholder } from '../components/Placeholder'

export function Campaigns() {
  return (
    <Placeholder title="Briefs" phase="phase 3 seeds the first campaign">
      <Link
        to="/campaigns/new"
        className="flex min-h-tap items-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-text active:bg-surface-raised"
      >
        + New campaign
      </Link>
    </Placeholder>
  )
}
