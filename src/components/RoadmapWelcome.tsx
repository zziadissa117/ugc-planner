// The first thing a student sees: "Welcome to UGC Roadmap", in the UGC Roadmap
// style - his sales-call deck, written down in the cutter repo's
// docs/UGC_ROADMAP_STYLE.md. Its own palette on purpose: this is the brand's
// cover page, not one of the planner's instrument screens, so the deck's blue
// is decoration here and nowhere else in the app.
//
// The deck's pieces, as a web page: its centred-page background (the blue
// glow), the cover logo, a spaced blue label over a bold cream title, a row of dark
// square cards each with a numbered spot, the last one the blue highlight
// card, a long dark bar under them, and the blue button.

import type { CSSProperties, ReactNode } from 'react'

const C = {
  bg: '#0A0B0E',
  title: '#F4F3EF',
  body: '#B9BCC4',
  dim: '#8A8D93',
  blue: '#86A8FF',
  card: '#16181D',
  edge: '#2A2D35',
}
const FONT = 'Arial, "Liberation Sans", Helvetica, sans-serif'
const HIGHLIGHT = 'linear-gradient(135deg, #6585F5 0%, #1D40C2 100%)'

function Label({ children, color = C.blue, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <p style={{ color, fontWeight: 700, fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', ...style }}>
      {children}
    </p>
  )
}

function Card({
  spot,
  label,
  title,
  children,
  high = false,
}: {
  spot: string
  label: string
  title: string
  children: ReactNode
  high?: boolean
}) {
  return (
    <div
      className="flex flex-col gap-3 p-6"
      style={{
        background: high ? HIGHLIGHT : C.card,
        border: `1px solid ${high ? 'rgba(255,255,255,0.28)' : C.edge}`,
      }}
    >
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full"
        style={{ background: high ? 'rgba(255,255,255,0.18)' : C.edge, color: high ? '#fff' : C.blue, fontWeight: 700, fontSize: 17 }}
      >
        {spot}
      </span>
      <Label color={high ? '#fff' : C.blue} style={{ fontSize: 11, marginTop: 8 }}>
        {label}
      </Label>
      <h2 style={{ color: high ? '#fff' : C.title, fontWeight: 700, fontSize: 19, lineHeight: 1.2 }}>{title}</h2>
      <p style={{ color: high ? '#fff' : C.body, fontSize: 14, lineHeight: 1.45 }}>{children}</p>
    </div>
  )
}

export function RoadmapWelcome({ onStart, editing = false }: { onStart: () => void; editing?: boolean }) {
  return (
    // Edge to edge, like a cover page: the negative margins undo the shell's
    // own padding; the height leaves the bottom bar.
    <div
      // The deck's centred-page background (bg-logo: the glow in the middle).
      // Its road "U" title background is for a cover with the title on the
      // left; behind centred cards the U only peeked out between them.
      className="-mx-4 -mb-6 -mt-5 flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[url('/roadmap/bg-logo.jpeg')] bg-cover bg-center px-4 py-10"
      style={{ backgroundColor: C.bg, fontFamily: FONT }}
    >
      <div className="flex w-full max-w-4xl flex-col items-center gap-8 text-center">
        <img src="/roadmap/logo-cover.png" alt="UGC Roadmap" className="h-auto w-40 sm:w-48" />

        <div className="flex flex-col items-center gap-4">
          <Label>{editing ? 'Your recording week' : 'Welcome'}</Label>
          <h1 style={{ color: C.title, fontWeight: 700, fontSize: 'clamp(2rem, 7vw, 2.75rem)', lineHeight: 1.1 }}>
            {editing ? 'Change your week' : 'Welcome to UGC Roadmap'}
          </h1>
          <p className="max-w-xl" style={{ color: C.body, fontSize: 16, lineHeight: 1.5 }}>
            First, your recording week. How it works:
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-5 text-left md:grid-cols-3">
          <Card spot="1" label="Record" title="Three days a week. Not every day.">
            Recording every day leads to burnout, and to posting everything at 11 pm because the day got away from you.
            Instead you record in batches, on three set days, at a time you reserve for it. Be strict with that time.
          </Card>
          <Card spot="2" label="Improve" title="The other days, you get better">
            The other days are for ideating, A/B testing and improving your content - you don&apos;t have to post every
            day, and you get a better feedback loop when you&apos;re not rushed.
          </Card>
          <Card spot="!" label="Important" title="Start with Trybe videos" high>
            Each recording session starts with Trybe videos: videos you send to brands, with no account to create. Set
            the timer and make as many as you can. Then base UGC - or media maxing on your third day.
          </Card>
        </div>

        <div
          className="flex w-full items-center gap-4 px-5 py-3 text-left"
          style={{ background: C.card, border: `1px solid ${C.edge}` }}
        >
          <span aria-hidden className="shrink-0" style={{ color: C.blue, fontWeight: 700, fontSize: 18 }}>
            →
          </span>
          <p style={{ color: C.title, fontSize: 14, lineHeight: 1.4 }}>
            Next: how long each session runs, then your three days and the time you reserve for them.
          </p>
        </div>

        <button
          type="button"
          onClick={onStart}
          className="press min-h-tap px-8 py-3"
          style={{ background: HIGHLIGHT, border: '1px solid rgba(255,255,255,0.28)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: FONT }}
        >
          {editing ? 'Change my week' : "Let's set it up"}
        </button>
      </div>
    </div>
  )
}
