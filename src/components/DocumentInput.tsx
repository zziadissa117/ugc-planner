// One document slot. Tap-to-pick comes first and is the biggest target:
// phones do not really drag and drop, and SPEC section 7 says that matters
// more than the drop area does. Shared between NewCampaign and UpdateCampaign
// so both read a dropped or pasted document identically.

import { useCallback, useRef, useState } from 'react'

import { UploadIcon } from './icons'

export interface Upload {
  text: string
  filename: string | null
}

export function DocumentInput({
  label,
  upload,
  onChange,
}: {
  label: string
  upload: Upload
  onChange: (upload: Upload) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const readFile = useCallback(
    (file: File) => {
      void file.text().then((text) => onChange({ text, filename: file.name }))
    },
    [onChange],
  )

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
        accept=".md,.markdown,.txt,text/markdown,text/plain"
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
        className="mt-3 w-full min-h-tap rounded-xl border border-edge px-4 font-semibold text-text press inline-flex items-center justify-center gap-2 active:bg-surface disabled:text-state-later"
      >
        <UploadIcon className="h-5 w-5 text-state-later" />
        {upload.filename ?? 'Choose a file'}
      </button>

      <textarea
        value={upload.text}
        onChange={(event) => onChange({ ...upload, text: event.target.value })}
        aria-label={`${label} text`}
        spellCheck={false}
        placeholder="or paste the text here"
        className="mt-3 h-32 w-full resize-y rounded-xl border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none"
      />

      {upload.text.trim() === '' ? null : (
        <p className="meta mt-2 text-state-later">
          {upload.text.length.toLocaleString()} characters, stored as-is.
        </p>
      )}
    </div>
  )
}
