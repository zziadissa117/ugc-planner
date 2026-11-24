// The UGC Roadmap look, as pieces for student-facing screens (the welcome and
// the onboarding quiz). It is his sales-call deck - docs/UGC_ROADMAP_STYLE.md
// in the cutter repo - carried onto the web: the deck's near-black with the
// blue glow, its cover logo, spaced blue labels over bold cream titles, dark
// cards with a numbered spot, the blue highlight card, and the "stops" tracker.
//
// Brought up to date on the way, because a literal copy read as old on a
// screen: the system font (SF Pro on his phone) instead of Arial, softly
// rounded cards with a hairline highlight, the highlight card glowing, pill
// buttons with an arrow that moves, and a faint dot grid fading out from the
// glow. Its own palette on purpose - these are brand pages, not the planner's
// instrument screens.

import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react'

import { ArrowRightIcon, CheckIcon } from './icons'

export const R = {
  bg: '#0A0B0E',
  title: '#F4F3EF',
  body: '#B9BCC4',
  dim: '#8A8D93',
  blue: '#86A8FF',
  card: '#14161B',
  edge: '#2A2D35',
  line: '#3A3E47',
}
export const HIGHLIGHT = 'linear-gradient(135deg, #6585F5 0%, #1D40C2 100%)'
const GLOW = '0 24px 60px -24px rgba(72, 108, 245, 0.75)'

/** The whole page: the glow, a dot grid fading out from it, the logo, and the
 *  stops tracker when it is a step. Edge to edge - the shell's padding undone. */
export function RoadmapPage({
  children,
  step,
  steps,
  aside,
  wide = false,
}: {
  children: ReactNode
  /** 1-based step for the tracker; none on the welcome. */
  step?: number
  steps?: number
  aside?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="relative -mx-4 -mb-6 -mt-5 min-h-dvh overflow-hidden" style={{ backgroundColor: R.bg }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[url('/roadmap/bg-logo.jpeg')] bg-cover bg-top" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(134,168,255,0.16) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(ellipse 70% 55% at 50% 18%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 55% at 50% 18%, black 0%, transparent 75%)',
        }}
      />
      <div className={`relative mx-auto flex w-full flex-col px-5 pb-14 pt-6 sm:pt-8 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
        <header className="flex items-center justify-between gap-4">
          <img src="/roadmap/logo-cover.png" alt="UGC Roadmap" className="h-8 w-auto sm:h-9" />
          <div className="flex items-center gap-4">
            {aside}
            {step && steps ? <Stops current={step} total={steps} /> : null}
          </div>
        </header>
        <div className="flex flex-col">{children}</div>
      </div>
    </div>
  )
}

/** The deck's stops: numbered circles joined by a dashed line, the current one
 *  lit blue, the ones behind it ticked. */
export function Stops({ current, total }: { current: number; total: number }) {
  return (
    <ol aria-label={`Step ${current} of ${total}`} className="flex items-center">
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1
        const done = n < current
        const on = n === current
        return (
          <li key={n} className="flex items-center">
            {i > 0 ? <span aria-hidden className="h-px w-3 sm:w-5" style={{ borderTop: `1.5px dashed ${n <= current ? R.blue : R.line}` }} /> : null}
            <span
              aria-current={on ? 'step' : undefined}
              className="flex size-6 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300 sm:size-7"
              style={{
                background: on ? HIGHLIGHT : done ? 'rgba(134,168,255,0.14)' : R.bg,
                border: `1.5px solid ${on || done ? R.blue : R.line}`,
                color: on ? '#fff' : done ? R.blue : R.dim,
                boxShadow: on ? '0 0 0 4px rgba(101,133,245,0.18)' : undefined,
              }}
            >
              {done ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} /> : n}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function Kicker({ children, color = R.blue, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color, ...style }}>
      {children}
    </p>
  )
}

/** The step's title block: spaced blue label, bold cream title, grey line. */
export function Heading({
  kicker,
  title,
  lead,
  center = false,
  big = false,
}: {
  kicker: string
  title: ReactNode
  lead?: ReactNode
  center?: boolean
  big?: boolean
}) {
  return (
    <div className={`settle-in flex flex-col gap-3 ${center ? 'items-center text-center' : ''}`}>
      <Kicker>{kicker}</Kicker>
      <h1
        className="font-bold"
        style={{
          color: R.title,
          fontSize: big ? 'clamp(2.25rem, 8vw, 3.5rem)' : 'clamp(1.75rem, 6vw, 2.375rem)',
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
        }}
      >
        {title}
      </h1>
      {lead ? (
        <p className={`text-base leading-relaxed sm:text-[17px] ${center ? 'max-w-xl' : 'max-w-2xl'}`} style={{ color: R.body }}>
          {lead}
        </p>
      ) : null}
    </div>
  )
}

/** Words in the deck's blue, as a gradient - for the brand name in a title. */
export function Blue({ children }: { children: ReactNode }) {
  return (
    <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(120deg, #A9C0FF 0%, #6585F5 55%, #4A6CF0 100%)' }}>
      {children}
    </span>
  )
}

export function cardStyle(high = false): CSSProperties {
  return high
    ? { background: HIGHLIGHT, border: '1px solid rgba(255,255,255,0.22)', boxShadow: `${GLOW}, inset 0 1px 0 rgba(255,255,255,0.25)` }
    : {
        background: `linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%), ${R.card}`,
        border: `1px solid ${R.edge}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }
}

/** A numbered spot on a card, as in the deck. */
export function Spot({ children, high = false }: { children: ReactNode; high?: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold"
      style={
        high
          ? { background: 'rgba(255,255,255,0.18)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)' }
          : { background: 'rgba(134,168,255,0.10)', color: R.blue, boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.28)' }
      }
    >
      {children}
    </span>
  )
}

/** The deck's card: spot, spaced label, bold title, a line of text. */
export function InfoCard({
  spot,
  label,
  title,
  children,
  high = false,
  index = 0,
}: {
  spot: ReactNode
  label: string
  title: string
  children: ReactNode
  high?: boolean
  index?: number
}) {
  return (
    <div className="settle-in flex flex-col gap-3 rounded-2xl p-6" style={{ ...cardStyle(high), '--i': index } as CSSProperties}>
      <Spot high={high}>{spot}</Spot>
      <Kicker color={high ? 'rgba(255,255,255,0.85)' : R.blue} style={{ marginTop: 6 }}>
        {label}
      </Kicker>
      <h2 className="text-[19px] font-bold leading-snug tracking-[-0.01em]" style={{ color: high ? '#fff' : R.title }}>
        {title}
      </h2>
      <p className="text-[14.5px] leading-relaxed" style={{ color: high ? 'rgba(255,255,255,0.92)' : R.body }}>
        {children}
      </p>
    </div>
  )
}

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#86A8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0B0E]'

/** The blue pill. Lifts and brightens under the pointer; its arrow slides. */
export function PrimaryButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`group press inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full px-7 text-[15px] font-semibold text-white transition-[transform,filter,box-shadow,opacity] duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:brightness-100 ${focusRing} ${className}`}
      style={{ background: HIGHLIGHT, boxShadow: `${GLOW}, inset 0 1px 0 rgba(255,255,255,0.28)`, border: '1px solid rgba(255,255,255,0.2)' }}
    >
      {children}
      <ArrowRightIcon aria-hidden className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-1 group-disabled:translate-x-0" strokeWidth={2} />
    </button>
  )
}

export function GhostButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`press inline-flex min-h-12 items-center justify-center gap-2 rounded-full border px-6 text-[15px] font-semibold transition-colors duration-200 hover:border-[#3A3E47] hover:bg-white/[0.04] hover:text-[#F4F3EF] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${className}`}
      style={{ borderColor: R.edge, color: R.body }}
    >
      {children}
    </button>
  )
}

/** Back on the left, the way on on the right. */
export function StepNav({ onBack, next }: { onBack?: () => void; next: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onBack ? <GhostButton onClick={onBack}>Back</GhostButton> : <span />}
      {next}
    </div>
  )
}

/** A choice he picks one of: a card that lights up blue when chosen. */
export function ChoiceCard({
  selected,
  onSelect,
  title,
  badge,
  children,
  index = 0,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  badge?: string
  children?: ReactNode
  index?: number
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={badge ? `${title} · ${badge.toLowerCase()}` : title}
      onClick={onSelect}
      className={`settle-in flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 ${focusRing}`}
      style={
        {
          ...cardStyle(false),
          ...(selected
            ? {
                background: 'linear-gradient(135deg, rgba(101,133,245,0.20) 0%, rgba(29,64,194,0.14) 100%), #12151D',
                borderColor: R.blue,
                boxShadow: '0 0 0 3px rgba(101,133,245,0.16), inset 0 1px 0 rgba(255,255,255,0.06)',
              }
            : {}),
          '--i': index,
        } as CSSProperties
      }
    >
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-200"
        style={{ background: selected ? HIGHLIGHT : 'transparent', border: `1.5px solid ${selected ? R.blue : R.line}` }}
      >
        {selected ? <CheckIcon className="h-3.5 w-3.5 text-white" strokeWidth={2.75} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[17px] font-semibold" style={{ color: R.title }}>
            {title}
          </span>
          {badge ? (
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ background: 'rgba(134,168,255,0.12)', color: R.blue, boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.3)' }}
            >
              {badge}
            </span>
          ) : null}
        </span>
        {children}
      </span>
    </button>
  )
}

export const INPUT_STYLE: CSSProperties = { background: '#0F1116', color: R.title }
// The border colour is a class, not inline: inline it outranked the blue focus
// border, and focus fell back to the app's white outline.
export const INPUT =
  'w-full rounded-xl border border-[#2A2D35] px-4 text-[16px] transition-[border-color,box-shadow] duration-200 placeholder:text-[#8A8D93] hover:border-[#3A3E47] focus:border-[#86A8FF] focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-[#6585F5]/20'

/** A labelled box he types in. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (props: { id: string }) => ReactNode
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-semibold" style={{ color: R.title }}>
        {label}
      </label>
      {children({ id })}
      {hint ? (
        <p className="text-[13px]" style={{ color: R.dim }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT} h-12`} style={INPUT_STYLE} />
}
