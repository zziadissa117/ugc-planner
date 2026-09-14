// The ka-ching.
//
// "it plays a money sounds and adds that to the money made today total in a
// very dopamine giving way. This is just to help me keep going."
//
// Synthesised rather than a file, for three reasons that all matter here: the
// app has to work with the network off, the bundle should not carry an audio
// asset for one flourish, and a sound built from oscillators has no licence
// attached to it. Two notes a major sixth apart with a fast decay - the shape
// of a till, not a game.
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

/** A single struck note that decays. */
function ring(ctx: AudioContext, hz: number, startAt: number, seconds: number, gain: number): void {
  const osc = ctx.createOscillator()
  const envelope = ctx.createGain()

  // Triangle rather than sine: a little more edge, so it carries over a room
  // without being harsh at the volumes a laptop speaker actually produces.
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(hz, startAt)

  envelope.gain.setValueAtTime(0, startAt)
  envelope.gain.linearRampToValueAtTime(gain, startAt + 0.008)
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds)

  osc.connect(envelope).connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + seconds)
}

/** The money sound: two notes, the second a major sixth above the first. */
export function playCashRegister(): void {
  if (isMuted()) return
  const ctx = audio()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    // B5 then G#6 - the interval a till makes, bright without being shrill.
    ring(ctx, 987.77, now, 0.18, 0.22)
    ring(ctx, 1661.22, now + 0.055, 0.34, 0.18)
  } catch {
    /* nothing to do - the tick already landed, which is the part that counts */
  }
}
