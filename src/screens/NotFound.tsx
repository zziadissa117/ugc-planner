import { Link } from 'react-router-dom'

import { BackIcon } from '../components/icons'
import { ScreenHeader } from '../components/ui'
import { buttonClass } from '../components/styles'

export function NotFound() {
  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <ScreenHeader title="No such screen" />
      <Link to="/" className={`${buttonClass('quiet')} self-start`}>
        <BackIcon className="h-4 w-4" />
        Back to NOW
      </Link>
    </section>
  )
}
