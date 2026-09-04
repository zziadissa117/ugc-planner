import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <section className="mx-auto max-w-screen-sm">
      <h1 className="text-2xl font-semibold text-text">No such screen</h1>
      <Link
        to="/"
        className="mt-6 flex min-h-tap items-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-text active:bg-surface-raised"
      >
        Back to NOW
      </Link>
    </section>
  )
}
