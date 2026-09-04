import { Link } from 'react-router-dom'

import { Placeholder } from '../components/Placeholder'

export function Now() {
  return (
    <Placeholder title="NOW" phase="phase 4 builds this screen">
      <ul className="flex flex-col gap-3">
        <li>
          <Link
            to="/tick-off"
            className="flex min-h-tap items-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-text active:bg-surface-raised"
          >
            Already posted some? Tick them off
          </Link>
        </li>
        <li>
          <Link
            to="/shoot"
            className="flex min-h-tap items-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-text active:bg-surface-raised"
          >
            SHOOT
          </Link>
        </li>
      </ul>
    </Placeholder>
  )
}
