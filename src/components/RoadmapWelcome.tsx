// The first thing a student sees: "Welcome to UGC Roadmap", in the UGC Roadmap
// look (src/components/roadmap.tsx). Opens the onboarding quiz, and opens it
// again from Setup when he changes his week.

import type { CSSProperties, ReactNode } from 'react'

import { CalendarIcon } from './icons'
import { Blue, Heading, InfoCard, PrimaryButton, R, RoadmapPage, cardStyle } from './roadmap'

export function RoadmapWelcome({ onStart, editing = false, aside }: { onStart: () => void; editing?: boolean; aside?: ReactNode }) {
  return (
    <RoadmapPage wide aside={aside}>
      <div className="flex flex-col items-center gap-10 pt-10 sm:pt-16">
        <Heading
          center
          big
          kicker={editing ? 'Your recording week' : 'Welcome'}
          title={
            editing ? (
              'Change your week'
            ) : (
              <>
                Welcome to <Blue>UGC Roadmap</Blue>
              </>
            )
          }
          lead="First, your recording week. Here's how it works."
        />

        <div className="grid w-full grid-cols-1 gap-4 text-left md:grid-cols-3">
          <InfoCard index={1} spot="1" label="Record" title="Three days a week. Not every day.">
            Recording every day leads to burnout, and to posting everything at 11 pm because the day got away from you.
            Instead you record in batches, on three set days, at a time you reserve for it. Be strict with that time.
          </InfoCard>
          <InfoCard index={2} spot="2" label="Improve" title="The other days, you get better">
            The other days are for ideating, A/B testing and improving your content - you don&apos;t have to post every
            day, and you get a better feedback loop when you&apos;re not rushed.
          </InfoCard>
          <InfoCard index={3} spot="!" label="Important" title="Start with Trybe videos" high>
            Each recording session starts with Trybe videos: videos you send to brands, with no account to create. Set
            the timer and make as many as you can. Then base UGC - or media maxing on your third day.
          </InfoCard>
        </div>

        <div className="settle-in flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left" style={{ ...cardStyle(false), '--i': 4 } as CSSProperties}>
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(134,168,255,0.10)', color: R.blue, boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.28)' }}
          >
            <CalendarIcon className="h-[18px] w-[18px]" />
          </span>
          <p className="text-[14.5px] leading-snug" style={{ color: R.title }}>
            Next: how long each session runs, then your three days and the time you reserve for them.{' '}
            <span style={{ color: R.dim }}>About 2 minutes.</span>
          </p>
        </div>

        <div className="settle-in" style={{ '--i': 5 } as CSSProperties}>
          <PrimaryButton onClick={onStart} className="min-h-14 px-9 text-base">
            {editing ? 'Change my week' : "Let's set it up"}
          </PrimaryButton>
        </div>
      </div>
    </RoadmapPage>
  )
}
