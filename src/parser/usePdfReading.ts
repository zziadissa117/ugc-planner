// The PDF option on the two document screens: whether this account has it,
// and whether a PDF is still being written out (so Review waits for it).

import { useEffect, useState } from 'react'

import { pdfAllowed, transcribePdf } from './pdf'

export function usePdfReading(serverAvailable: boolean) {
  const [allowed, setAllowed] = useState(false)
  const [briefReading, setBriefReading] = useState(false)
  const [contractReading, setContractReading] = useState(false)

  useEffect(() => {
    if (!serverAvailable) return
    let live = true
    void pdfAllowed().then((ok) => {
      if (live) setAllowed(ok)
    })
    return () => {
      live = false
    }
  }, [serverAvailable])

  return {
    /** Shown in the slot labels: "(.md or .pdf)" for the owner. */
    kinds: allowed ? '.md or .pdf' : '.md',
    readPdf: allowed ? transcribePdf : undefined,
    reading: briefReading || contractReading,
    setBriefReading,
    setContractReading,
  }
}
