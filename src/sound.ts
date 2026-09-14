// The ka-ching.
//
// "it plays a money sounds and adds that to the money made today total in a
// very dopamine giving way. This is just to help me keep going."
//
// Synthesised rather than a file, for three reasons that all matter here: the
// app has to work with the network off, the bundle should not carry an audio
// asset for one flourish, and a sound built from oscillators has no licence
// attached to it.
//
// It is built as an actual till rather than as a chime: a burst of filtered
// noise for the drawer mechanism, then a bell struck twice. The bell is a set
// of INHARMONIC partials - overtones at 2.76x, 5.4x, 8.93x rather than at
// whole multiples - because that is what makes a sound read as struck metal.
// The first version was two triangle waves a major sixth apart and he said
// what it actually was: "i thought the sound was going to be more of a cha
// ching". Two pure notes is a doorbell.
//
// Every call is wrapped: audio is the one thing in this app allowed to fail
// silently. A browser that blocks it, a device with no output, an AudioContext
// the user gesture did not unlock - none of those are worth a broken tick on
// the screen he uses to record a day's work.

const MUTED_KEY = 'ugc-planner.muted'

/** One context for the life of the tab. Constructing one per sound leaks
 *  handles and eventually stops playing anything at all. */
let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    context ??= new Ctor()
    // Browsers suspend the context until a gesture. Every caller here is
    // already inside a click, so this resolves immediately in practice.
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === 'true'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, String(muted))
  } catch {
    /* the toggle still holds for this session */
  }
}

/** The inharmonic partials of a struck bell.
 *
 *  A bell is not a note. Its overtones sit at ratios nothing like 2x, 3x, 4x,
 *  and that is exactly why it reads as metal rather than as a synthesiser -
 *  the first version of this was two triangle waves a sixth apart and sounded
 *  like a doorbell, which is what he told me. These ratios are the classic
 *  strike tone of a struck bell; the higher ones fade fastest, which is the
 *  other half of why real metal sounds the way it does. */
const BELL_PARTIALS = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.76, gain: 0.62, decay: 0.7 },
  { ratio: 5.4, gain: 0.38, decay: 0.45 },
  { ratio: 8.93, gain: 0.22, decay: 0.28 },
  { ratio: 13.34, gain: 0.12, decay: 0.18 },
]

/** One bell strike: every partial struck together, each fading at its own
 *  rate. */
function strike(
  ctx: BaseAudioContext,
  hz: number,
  at: number,
  seconds: number,
  level: number,
): void {
  for (const partial of BELL_PARTIALS) {
    const osc = ctx.createOscillator()
    const envelope = ctx.createGain()

    // Sine per partial: the metal comes from the ratios above, not from the
    // waveform. A richer wave on top of them only muddies it.
    osc.type = 'sine'
    osc.frequency.setValueAtTime(hz * partial.ratio, at)

    const peak = level * partial.gain
    envelope.gain.setValueAtTime(0, at)
    // 3ms attack: a struck bell has no fade-in, and anything slower reads as
    // a synth pad rather than as something hit.
    envelope.gain.linearRampToValueAtTime(peak, at + 0.003)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds * partial.decay)

    osc.connect(envelope).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + seconds)
  }
}

/** The "cha": the drawer mechanism, before the bell rings.
 *
 *  Filtered noise rather than a tone, because it is a mechanism and not a
 *  note. Without it the sound is a bell on its own, which is a chime. */
function chk(ctx: BaseAudioContext, at: number, seconds: number, level: number): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    // Decaying white noise: a scrape, not a hiss.
    samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer

  // Bandpassed high and narrow, so it lands as metal being struck rather than
  // as a burst of static.
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(3200, at)
  filter.Q.setValueAtTime(1.4, at)

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(level, at)
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds)

  source.connect(filter).connect(envelope).connect(ctx.destination)
  source.start(at)
  source.stop(at + seconds)
}

/** Schedules the whole cha-ching into any context, live or offline.
 *
 *  Separate from playCashRegister so a test can render it into an
 *  OfflineAudioContext and check the shape of what comes out, rather than
 *  taking on trust that a pile of oscillators sounds like a till. */
export function scheduleCashRegister(ctx: BaseAudioContext, at: number): void {
  // "cha" - the drawer.
  chk(ctx, at, 0.055, 0.5)
  // "CHING" - the bell, struck twice a semitone or so apart, the second
  // quieter and a beat later. One strike is a bell; two is a till.
  strike(ctx, 1046.5, at + 0.02, 0.85, 0.2)
  strike(ctx, 1396.9, at + 0.1, 1.05, 0.16)
}

/** The money sound. */
export function playCashRegister(): void {
  if (isMuted()) return
  const ctx = audio()
  if (!ctx) return

  try {
    scheduleCashRegister(ctx, ctx.currentTime)
  } catch {
    /* nothing to do - the tick already landed, which is the part that counts */
  }
}
