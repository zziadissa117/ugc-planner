// The few pieces every screen is built from.
//
// The app's look is "instrument": a black ground, hairlines instead of boxes,
// big tabular numbers, and a dot for state - the neural view's language. These
// used to be re-typed on every screen as long class strings, a little
// differently each time (five spellings of "the grey button", three of a
// section heading). One copy here means one place to get it right.
//
// Colour still means state and nothing else. `Tone` is the five states from
// index.css, and it is the only way any of these take a colour.

import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ChevronDownIcon, ChevronRightIcon } from './icons'
import { TONE_TEXT, buttonClass, type Tone, type Variant } from './styles'

const TONE_DOT: Record<Tone, string> = {
  posted: 'bg-state-posted shadow-[0_0_10px_0_var(--color-state-posted)]',
  now: 'bg-state-now shadow-[0_0_10px_0_color-mix(in_oklab,var(--color-state-now)_55%,transparent)]',
  later: 'bg-state-later/70',
  waiting: 'bg-state-waiting',
  blocked: 'bg-state-blocked shadow-[0_0_10px_0_color-mix(in_oklab,var(--color-state-blocked)_60%,transparent)]',
}

/** A row's state, as a dot. The network view marks every node this way, and
 *  a dot is the smallest thing that can carry a colour and still be read
 *  from across a room. */
export function StateDot({ tone, className = '' }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${className}`} />
}

/** A screen's title. Small, because on every screen the number is the
 *  headline and the title is only where you are. */
export function ScreenHeader({
  title,
  meta,
  aside,
}: {
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] font-semibold leading-tight tracking-[-0.015em] text-text">
          {title}
        </h1>
        {meta ? <p className="meta mt-1 text-state-later">{meta}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  )
}

/** A section's caption, with a hairline running out to the edge. The rule
 *  is what separates sections now that nothing is boxed. */
export function SectionLabel({
  children,
  tone = 'later',
  trailing,
  as: Tag = 'h2',
}: {
  children: ReactNode
  tone?: Tone
  trailing?: ReactNode
  as?: 'h2' | 'h3'
}) {
  return (
    <div className="flex items-center gap-3">
      <Tag className={`label shrink-0 ${TONE_TEXT[tone]}`}>{children}</Tag>
      <span aria-hidden className="h-px flex-1 bg-rule" />
      {trailing ? <span className="label shrink-0 text-state-later">{trailing}</span> : null}
    </div>
  )
}

export function Button({
  variant = 'quiet',
  size = 'tap',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'tap' | 'big' | 'small'
}) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />
}

/** A whole block that is one tap - FILM, POST. Cards are allowed exactly
 *  here, where the edge says "all of this is the button". */
export function ActionTile({
  icon,
  label,
  lit = false,
  className = '',
  ...rest
}: {
  icon: ReactNode
  label: string
  lit?: boolean
  className?: string
} & ({ to: string; onClick?: never } | { to?: never; onClick: () => void })) {
  const classes = [
    'press group flex min-h-[4.75rem] items-center justify-between gap-3 rounded-2xl border px-4',
    lit
      ? 'lit border-state-now/80 bg-surface text-state-now active:bg-surface-raised'
      : 'border-edge text-text active:bg-surface',
    className,
  ].join(' ')
  const inner = (
    <>
      <span className="flex items-center gap-3">
        <span className={lit ? 'text-state-now' : 'text-state-later'}>{icon}</span>
        <span className="text-lg font-semibold tracking-[0.18em]">{label}</span>
      </span>
      <ChevronRightIcon className="h-5 w-5 opacity-60 transition-transform duration-200 group-active:translate-x-0.5" />
    </>
  )
  if ('to' in rest && rest.to !== undefined) {
    return (
      <Link to={rest.to} className={classes}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={rest.onClick} className={classes}>
      {inner}
    </button>
  )
}

/** A folded section: a hairline row that opens. Native <details>, so it
 *  works with no JavaScript state and the find-in-page still reaches inside. */
export function Disclosure({
  summary,
  tone = 'text',
  trailing,
  children,
  className = '',
  ...details
}: {
  summary: ReactNode
  /** A state, or plain text for a section that is not one - white is "do
   *  this now", and a folded section is not asking for anything. */
  tone?: Tone | 'text'
  trailing?: ReactNode
  children: ReactNode
  className?: string
} & Omit<ComponentProps<'details'>, 'children'>) {
  return (
    <details className={`group/disclosure border-b border-rule ${className}`} {...details}>
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className={`min-w-0 flex-1 text-base font-semibold ${tone === 'text' ? 'text-text' : TONE_TEXT[tone]}`}>
          {summary}
        </span>
        {trailing ? <span className="meta shrink-0 text-state-later">{trailing}</span> : null}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-state-later transition-transform duration-300 [transition-timing-function:var(--ease-settle)] group-open/disclosure:rotate-180" />
      </summary>
      <div className="settle-in pb-4">{children}</div>
    </details>
  )
}
