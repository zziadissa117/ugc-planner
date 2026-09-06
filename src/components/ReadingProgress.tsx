// The one wait in the app that is a real network round trip. Shared between
// NewCampaign and UpdateCampaign - both send documents to the same parser.
//
// Indeterminate on purpose: the request reports no progress, so a bar filling
// towards a percentage would be a number nobody measured. The elapsed count is
// measured, so that is what it shows - enough to tell "working" from "hung"
// without pretending to know more than it does.

import { useEffect, useState } from 'react'

export function ReadingProgress() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div
      role="progressbar"
      aria-label="Reading the documents"
      aria-busy="true"
      className="flex flex-col gap-2"
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-raised">
        <div className="indeterminate-bar h-full w-1/4 rounded-full bg-state-now" />
      </div>
      <p className="text-sm text-state-later">
        Reading the documents - {seconds}s. Usually takes about ten.
      </p>
    </div>
  )
}
