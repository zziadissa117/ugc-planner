// What a screen shows when its code throws.
//
// Without this, React Router showed its developer page: "Unexpected
// Application Error!", the stack trace in a grey box, and "Hey developer" -
// on every tab the crash reached, which read as the app being full of errors.
// Nothing he saved is at risk when a screen throws: every write landed in
// the store before the screen tried to draw it. So this says that, in plain
// words, keeps the one line that names what broke (for a screenshot), and
// offers the way out. The bottom nav stays, because the error is caught per
// screen, so the other tabs keep working.

import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { BackIcon } from '../components/icons'
import { buttonClass } from '../components/styles'
import { Button, SectionLabel } from '../components/ui'

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim()
  if (error instanceof Error) return error.message
  return String(error)
}

export function ScreenError() {
  const error = useRouteError()
  const detail = describe(error)
  const stack = error instanceof Error && error.stack ? error.stack : null

  return (
    <section role="alert" className="mx-auto flex max-w-screen-sm flex-col gap-5">
      <SectionLabel tone="blocked">This screen hit a problem</SectionLabel>
      <p className="text-lg leading-snug text-text">
        Nothing you saved is lost - everything is kept on this device. Reloading usually puts it right.
      </p>
      <p className="meta break-words text-state-later">{detail}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="now" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Link to="/" className={buttonClass('quiet')}>
          <BackIcon className="h-4 w-4" />
          Back to NOW
        </Link>
      </div>
      {stack ? (
        <details className="meta text-state-later">
          <summary className="cursor-pointer">Details, for a screenshot</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{stack}</pre>
        </details>
      ) : null}
    </section>
  )
}
