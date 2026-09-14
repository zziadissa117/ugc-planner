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
// That was the reasoning behind synthesising it, and it was wrong about the
// part that mattered. Two triangle waves was a doorbell; a noise transient
// and an inharmonic bell was closer but still not a till, and he ended it by
// recording one and sending it over: "use this sound exactly". No amount of
// measuring a waveform gets to the sound in someone's head.
//
// So the recording is what plays. It is 9KB, trimmed to start on the
// transient so it fires the instant he taps, and precached by the service
// worker (see globPatterns in vite.config.ts) so it still works with the
// network off. The synthesised version stays as the fallback for the one tap
// where it has not finished decoding, and for a browser that will not decode
// mp3 at all - a quieter approximation beats silence.
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
 *  and that is why it reads as metal rather than as a synthesiser. Kept as the
 *  fallback below - it is close enough to be better than silence on the one
 *  tap where the recording has not finished decoding. */
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

    osc.type = 'sine'
    osc.frequency.setValueAtTime(hz * partial.ratio, at)

    const peak = level * partial.gain
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(peak, at + 0.003)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds * partial.decay)

    osc.connect(envelope).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + seconds)
  }
}

/** The "cha": the drawer mechanism, before the bell rings. */
function chk(ctx: BaseAudioContext, at: number, seconds: number, level: number): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer

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

/** The synthesised stand-in. Kept because it needs nothing loaded and cannot
 *  fail on a slow first tap; the recording is what he actually hears. */
export function scheduleCashRegister(ctx: BaseAudioContext, at: number): void {
  chk(ctx, at, 0.055, 0.5)
  strike(ctx, 1046.5, at + 0.02, 0.85, 0.2)
  strike(ctx, 1396.9, at + 0.1, 1.05, 0.16)
}

/** His own recording, trimmed to the transient. */
export const CASH_REGISTER_URL = '/sounds/cha-ching.mp3'

let sample: AudioBuffer | null = null
let loading: Promise<void> | null = null

/** Fetches and decodes the recording, once.
 *
 *  Called when the Post screen mounts rather than on the first tap, so the
 *  sound is ready before he can reach a box. Decoding needs an AudioContext,
 *  and a browser will not give a usable one before a gesture - so a context
 *  that is still suspended decodes fine, it simply cannot play yet, which is
 *  exactly the order we want. */
export function primeCashRegister(): void {
  if (sample !== null || loading !== null) return
  const ctx = audio()
  if (!ctx) return

  loading = (async () => {
    try {
      const response = await fetch(CASH_REGISTER_URL)
      if (!response.ok) return
      sample = await ctx.decodeAudioData(await response.arrayBuffer())
    } catch {
      // Offline before the service worker cached it, a blocked fetch, a
      // browser that cannot decode mp3. The synth covers all three.
    }
  })()
}

/** The money sound: his recording where it has loaded, the synth until then. */
export function playCashRegister(): void {
  if (isMuted()) return
  const ctx = audio()
  if (!ctx) return

  try {
    if (sample === null) {
      // Start the load for next time, and make a noise now rather than none.
      primeCashRegister()
      scheduleCashRegister(ctx, ctx.currentTime)
      return
    }

    const source = ctx.createBufferSource()
    source.buffer = sample
    source.connect(ctx.destination)
    source.start(ctx.currentTime)
  } catch {
    /* nothing to do - the tick already landed, which is the part that counts */
  }
}
