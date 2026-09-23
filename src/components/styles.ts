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
  // The one thing to do next: white, lit from behind.
  now: 'lit border border-state-now/80 bg-surface text-state-now active:bg-surface-raised',
  // Everything else a button can be.
  quiet: 'border border-edge bg-transparent text-text active:bg-surface',
  // A button that reads as a line of text until pressed.
  ghost: 'border border-transparent text-state-later active:bg-surface',
  blocked: 'border border-state-blocked/70 text-state-blocked active:bg-state-blocked/10',
  waiting: 'border border-state-waiting/60 text-state-waiting active:bg-state-waiting/10',
  posted: 'border border-state-posted/60 text-state-posted active:bg-state-posted/10',
}

/** The classes for a button, for the places a Link has to look like one. */
export function buttonClass(variant: Variant = 'quiet', size: 'tap' | 'big' | 'small' = 'tap'): string {
  const sizing =
    size === 'big'
      ? 'min-h-[4.25rem] px-5 text-lg tracking-[0.04em]'
      : size === 'small'
        ? 'min-h-10 px-3 text-sm'
        : 'min-h-tap px-4 text-base'
  return [
    'press inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
    'disabled:border-edge disabled:text-state-later disabled:shadow-none',
    sizing,
    VARIANT[variant],
  ].join(' ')
}

/** The input look, for every text box and number box in the app. Focus is
 *  shown by the border turning white rather than by the global focus ring,
 *  which drew a second outline around the first. */
export const INPUT_CLASS =
  'min-h-tap rounded-xl border border-edge bg-surface px-3 text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none'
