// The class strings behind the pieces in ui.tsx, kept apart from the
// components so the ones that are not components can be imported on their
// own (and so fast refresh keeps working on ui.tsx).
//
// Colour still means state and nothing else: `Tone` is the five states from
// index.css, and it is the only way any of these take a colour.

export type Tone = 'posted' | 'now' | 'later' | 'waiting' | 'blocked'

export const TONE_TEXT: Record<Tone, string> = {
  posted: 'text-state-posted',
  now: 'text-state-now',
  later: 'text-state-later',
  waiting: 'text-state-waiting',
  blocked: 'text-state-blocked',
}

export type Variant = 'now' | 'quiet' | 'ghost' | 'blocked' | 'waiting' | 'posted'

const VARIANT: Record<Variant, string> = {
  // The one thing to do next: the deck's blue pill, lifting under the
  // pointer - the same button as the quiz's.
  now: 'border border-white/20 bg-[linear-gradient(135deg,#6585F5_0%,#1D40C2_100%)] text-white shadow-[0_18px_44px_-20px_rgba(72,108,245,0.85),inset_0_1px_0_rgba(255,255,255,0.25)] hover:-translate-y-0.5 hover:brightness-110',
  // Everything else a button can be: a quiet outlined pill.
  quiet: 'border border-edge bg-white/[0.02] text-text-dim hover:border-edge-lit hover:bg-white/[0.05] hover:text-text',
  // A button that reads as a line of text until pressed.
  ghost: 'border border-transparent text-state-later hover:bg-white/[0.04] hover:text-text',
  blocked: 'border border-state-blocked/60 text-state-blocked hover:bg-state-blocked/10',
  waiting: 'border border-state-waiting/60 text-state-waiting hover:bg-state-waiting/10',
  posted: 'border border-state-posted/60 text-state-posted hover:bg-state-posted/10',
}

/** The classes for a button, for the places a Link has to look like one. */
export function buttonClass(variant: Variant = 'quiet', size: 'tap' | 'big' | 'small' = 'tap'): string {
  const sizing =
    size === 'big'
      ? 'min-h-[4.25rem] px-7 text-lg'
      : size === 'small'
        ? 'min-h-10 px-4 text-sm'
        : 'min-h-tap px-6 text-base'
  return [
    'press inline-flex items-center justify-center gap-2 rounded-full font-semibold',
    'transition-[transform,filter,background-color,border-color,color,box-shadow] duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
    'disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:brightness-100',
    sizing,
    VARIANT[variant],
  ].join(' ')
}

/** The input look, for every text box and number box in the app - the
 *  quiz's: a dark well whose edge turns blue, with a soft blue ring. */
export const INPUT_CLASS =
  'min-h-tap rounded-xl border border-edge bg-[#0f1116] px-4 text-text placeholder:text-state-later/80 transition-[border-color,box-shadow] duration-200 hover:border-edge-lit focus:border-brand focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-[#6585F5]/20'

/** A card: the deck's dark panel with a hairline highlight along its top. */
export const CARD_CLASS =
  'rounded-2xl border border-edge bg-[linear-gradient(180deg,rgba(255,255,255,0.035)_0%,rgba(255,255,255,0.01)_100%)] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
