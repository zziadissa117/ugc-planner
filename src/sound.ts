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

/** The context, made only when there is one to make.
 *
 *  `create` is false for callers that are not inside a click. A context
 *  constructed without a user gesture is born suspended, and a resume() from
 *  outside a gesture is rejected - so building one at mount left the tab with
 *  a context that could never start, and whether the till sounded came down to
 *  what he happened to tap first. */
/** Tells iOS this is media playback rather than an ambient noise.
 *
 *  THE reason he could not hear it. On iOS, Web Audio defaults to the ambient
 *  audio session, which the hardware silent switch mutes - while Safari still
 *  shows the tab's "audio playing" indicator, because the sound really is
 *  being produced. It is just routed nowhere. "it does the visual inside my
 *  safari browser that a sound is being played but its not i dont hear it" is
 *  that, exactly, and no amount of resuming the context would have fixed it.
 *
 *  navigator.audioSession is Safari 16.4 and up. Everywhere else it is absent
 *  and the guard does nothing, which is correct: no other platform silences
 *  Web Audio behind a physical switch.
 *
 *  'playback' is the category that ignores the switch. It can interrupt other
 *  audio on the device, so a till sound may duck music for its half second -
 *  worth it, since a sound he cannot hear is worth nothing at all. */
function claimPlaybackSession(): void {
  try {
    const session = (navigator as { audioSession?: { type: string } }).audioSession
    if (session && session.type !== 'playback') session.type = 'playback'
  } catch {
    /* not Safari, or the property is read-only here - nothing to claim */
  }
}

function audio(create: boolean): AudioContext | null {
  try {
    if (context === null) {
      if (!create) return null
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      // Before the context exists: the session category decides where its
      // output goes, and setting it afterwards can leave the first sound in
      // the wrong one.
      claimPlaybackSession()
      context = new Ctor()
    }
    return context
  } catch {
    return null
  }
}

/** Anything that is not 'running' and might be woken.
 *
 *  Checking only for 'suspended' missed the state that actually stranded him:
 *  iOS Safari parks a context at 'interrupted' after a call, a lock screen or
 *  an app switch, and it stays there until the app is killed - which is
 *  exactly "sometimes i gotta close it all for it to play". */
function wake(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'running') return Promise.resolve()
  try {
    return ctx.resume().catch(() => undefined)
  } catch {
    return Promise.resolve()
  }
}

/** Resumes the context whenever the page comes back to the front.
 *
 *  A backgrounded tab has its context suspended by the browser, and nothing
 *  was resuming it until the next tap - which is the tap that came out silent.
 *  Registered once, and only ever on a context that already exists. */
let watchingVisibility = false
function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined') return
  watchingVisibility = true
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && context !== null) void wake(context)
    })
  } catch {
    /* no document to listen on - nothing to keep awake */
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
let encoded: ArrayBuffer | null = null
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

  loading = (async () => {
    try {
      // The bytes first. Fetching needs no AudioContext, so this runs at mount
      // without creating one outside a gesture - that is what used to leave
      // the tab holding a context it could never start.
      const response = await fetch(CASH_REGISTER_URL)
      if (!response.ok) return
      encoded = await response.arrayBuffer()
      // Decode now only if a context already exists, i.e. he has tapped
      // something before. Otherwise the first tap decodes it.
      const ctx = audio(false)
      if (ctx !== null) await decodeInto(ctx)
    } catch {
      // Offline before the service worker cached it, a blocked fetch, a
      // browser that cannot decode mp3. The synth covers all three.
    }
  })()
}

/** Turns the fetched bytes into a buffer, once. */
async function decodeInto(ctx: AudioContext): Promise<void> {
  if (sample !== null || encoded === null) return
  try {
    // decodeAudioData consumes the buffer, so it is decoded from a copy and
    // the original kept - a failed decode must not leave us with nothing to
    // retry from on the next tap.
    sample = await ctx.decodeAudioData(encoded.slice(0))
  } catch {
    /* the synth covers it */
  }
}

/** The money sound: his recording where it has loaded, the synth until then. */
export function playCashRegister(): void {
  if (isMuted()) return
  // Every tap, not just the first. The category can be taken back by the
  // system after an interruption, and a context that already exists never
  // goes through the branch in audio() that claims it - so claiming it here
  // is what keeps the sound audible on the hundredth tick as well as the
  // first.
  claimPlaybackSession()
  // Inside a click, so this is where the context is allowed to be born.
  const ctx = audio(true)
  if (!ctx) return
  watchVisibility()

  try {
    const ready = wake(ctx)

    if (ctx.state === 'running' && sample !== null) {
      // The common case, and the only one that must not wait: fire it now so
      // the sound lands with the finger rather than a frame later.
      fire(ctx, sample)
      return
    }

    // Otherwise the context was asleep, or the recording is not decoded yet.
    // Wait for whichever it was and then play - scheduling into a suspended
    // context is what made a tap come out silent, because currentTime does not
    // advance until it resumes.
    void ready
      .then(async () => {
        if (sample === null) {
          primeCashRegister()
          await loading
          await decodeInto(ctx)
        }
        if (sample !== null) fire(ctx, sample)
        else scheduleCashRegister(ctx, ctx.currentTime)
      })
      .catch(() => undefined)
  } catch {
    /* nothing to do - the tick already landed, which is the part that counts */
  }
}

function fire(ctx: AudioContext, buffer: AudioBuffer): void {
  try {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(ctx.currentTime)
  } catch {
    /* audio is allowed to fail silently; the tick is what matters */
  }
}
