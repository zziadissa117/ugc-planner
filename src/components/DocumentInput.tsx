// One document slot. Tap-to-pick comes first and is the biggest target:
// phones do not really drag and drop, and SPEC section 7 says that matters
// more than the drop area does. Shared between NewCampaign and UpdateCampaign
// so both read a dropped or pasted document identically.
//
// A PDF is accepted only when `readPdf` is passed, which the screens do for
// the owner account alone (src/parser/pdf.ts). Without it a PDF is refused in
// words rather than read as text - its bytes are not a contract.

import { useCallback, useRef, useState } from 'react'

import { isPdf, MAX_PDF_BYTES } from '../parser/pdf'
import { UploadIcon } from './icons'

export interface Upload {
  text: string
  filename: string | null
}

export function DocumentInput({
  label,
  upload,
  onChange,
  readPdf,
  onReadingChange,
}: {
  label: string
  upload: Upload
  onChange: (upload: Upload) => void
  /** Writes a PDF out as text. Passed only for the owner account. */
  readPdf?: (file: File, onProgress: (characters: number) => void) => Promise<string>
  /** True while a PDF is being written out, so the screen can hold Review
   *  until the document is actually there. */
  onReadingChange?: (reading: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState<{ filename: string; characters: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const readFile = useCallback(
    (file: File) => {
      setProblem(null)
      if (!isPdf(file)) {
        void file.text().then((text) => onChange({ text, filename: file.name }))
        return
      }
      if (!readPdf) {
        setProblem('PDFs are not read on this account. Paste the text, or use a .md file.')
        return
      }
      if (file.size > MAX_PDF_BYTES) {
        setProblem('That PDF is over 15 MB. Split it, or paste the text instead.')
        return
      }
      setReading({ filename: file.name, characters: 0 })
      onReadingChange?.(true)
      void readPdf(file, (characters) => setReading({ filename: file.name, characters }))
        .then((text) => onChange({ text, filename: file.name }))
        .catch((caught: unknown) => setProblem(caught instanceof Error ? caught.message : String(caught)))
        .finally(() => {
          setReading(null)
          onReadingChange?.(false)
        })
    },
    [onChange, onReadingChange, readPdf],
  )

  const fromPdf = upload.filename !== null && /\.pdf$/i.test(upload.filename)

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) readFile(file)
      }}
      className={`rounded-2xl border p-4 transition-colors ${dragging ? 'border-state-now' : 'border-rule'}`}
    >
      <h2 className="label text-state-later">{label}</h2>

      <input
        ref={inputRef}
        type="file"
        accept={
          readPdf
            ? '.md,.markdown,.txt,text/markdown,text/plain,.pdf,application/pdf'
            : '.md,.markdown,.txt,text/markdown,text/plain'
        }
        aria-label={`${label} file`}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) readFile(file)
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={reading !== null}
        className="mt-3 w-full min-h-tap rounded-xl border border-edge px-4 font-semibold text-text press inline-flex items-center justify-center gap-2 active:bg-surface disabled:text-state-later"
      >
        <UploadIcon className="h-5 w-5 text-state-later" />
        {reading ? `Reading ${reading.filename}...` : (upload.filename ?? 'Choose a file')}
      </button>

      {reading ? (
        <div role="status" aria-label="Reading the PDF" className="mt-3 flex flex-col gap-2">
          <div className="h-px w-full overflow-hidden bg-rule">
            <div className="indeterminate-bar h-full w-1/4 bg-state-now" />
          </div>
          <p className="meta text-state-later">
            Claude is writing the PDF out as text
            {reading.characters > 0 ? ` - ${reading.characters.toLocaleString()} characters so far` : ''}. A
            long contract takes a minute or two.
          </p>
        </div>
      ) : null}

      {problem ? <p className="mt-2 text-sm text-state-blocked">{problem}</p> : null}

      <textarea
        value={upload.text}
        onChange={(event) => onChange({ ...upload, text: event.target.value })}
        aria-label={`${label} text`}
        spellCheck={false}
        placeholder="or paste the text here"
        className="mt-3 h-32 w-full resize-y rounded-xl border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none"
      />

      {upload.text.trim() === '' ? null : fromPdf ? (
        // Amber: nobody has checked this text yet, and it is what every quote
        // will be checked against.
        <p className="meta mt-2 text-state-waiting">
          Written out from the PDF by Claude - {upload.text.length.toLocaleString()} characters. Quotes are
          checked against this text, so skim the numbers against the PDF.
        </p>
      ) : (
        <p className="meta mt-2 text-state-later">
          {upload.text.length.toLocaleString()} characters, stored as-is.
        </p>
      )}
    </div>
  )
}
