// The few pieces every screen is built from.
//
// The look is the UGC Roadmap deck's, the same as the onboarding quiz
// (roadmap.tsx): near-black with a blue glow, spaced blue capitals over bold
// cream titles, softly rounded dark cards, blue pill buttons. These used to be
// re-typed on every screen as long class strings, a little differently each
// time. One copy here means one place to get it right.
//
// Blue is the brand and never a state. `Tone` is the five states from
// index.css, and it is the only way any of these say what something is.

import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ChevronDownIcon, ChevronRightIcon } from './icons'
import { CARD_CLASS, TONE_TEXT, buttonClass, type Tone, type Variant } from './styles'

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

/** A screen's title, as the deck sets one: a spaced blue caption, a bold
 *  cream title, a grey line under it. */
export function ScreenHeader({
  title,
  meta,
  aside,
  kicker,
}: {
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  kicker?: ReactNode
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <h1 className="display text-[clamp(1.75rem,6vw,2.375rem)] text-text">{title}</h1>
        {meta ? <p className="text-base text-text-dim">{meta}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  )
}

/** A section's caption: the deck's spaced blue capitals, with a hairline
 *  running out to the edge. A state tone colours it only when the section
 *  is that state ("Blocked", "Posted"). */
export function SectionLabel({
  children,
  tone,
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
      <Tag className={`kicker shrink-0 ${tone && tone !== 'later' ? TONE_TEXT[tone] : ''}`}>{children}</Tag>
      <span aria-hidden className="h-px flex-1 bg-rule" />
      {trailing ? <span className="label shrink-0 text-state-later">{trailing}</span> : null}
    </div>
  )
}

/** The deck's dark card. */
export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div className={`${CARD_CLASS} ${className}`} {...rest}>
      {children}
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
    'press group flex min-h-[4.75rem] items-center justify-between gap-3 rounded-2xl border px-5 transition-[transform,filter,border-color] duration-200 hover:-translate-y-0.5',
    lit
      ? 'border-white/20 bg-[linear-gradient(135deg,#6585F5_0%,#1D40C2_100%)] text-white shadow-[0_24px_60px_-24px_rgba(72,108,245,0.75),inset_0_1px_0_rgba(255,255,255,0.25)] hover:brightness-110'
      : `${CARD_CLASS} text-text hover:border-edge-lit`,
    className,
  ].join(' ')
  const inner = (
    <>
      <span className="flex items-center gap-3">
        <span className={lit ? 'text-white' : 'text-brand'}>{icon}</span>
        <span className="text-lg font-semibold tracking-[0.12em]">{label}</span>
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
    <details className={`group/disclosure ${CARD_CLASS} px-5 ${className}`} {...details}>
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className={`min-w-0 flex-1 text-base font-semibold ${tone === 'text' ? 'text-text' : TONE_TEXT[tone]}`}>
          {summary}
        </span>
        {trailing ? <span className="meta shrink-0 text-state-later">{trailing}</span> : null}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-brand transition-transform duration-300 [transition-timing-function:var(--ease-settle)] group-open/disclosure:rotate-180" />
      </summary>
      <div className="settle-in pb-4">{children}</div>
    </details>
  )
}
