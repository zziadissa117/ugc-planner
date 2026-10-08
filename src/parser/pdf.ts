// Reading a PDF contract, for the owner account only.
//
// A PDF is written out as Markdown by Claude on the server
// (supabase/functions/_shared/pdf.ts), and that transcript then takes the
// ordinary path: it fills the document box, gets parsed like pasted text, is
// stored as the document's raw text, and every quote is checked against it.
// Everyone else uses Markdown - a PDF costs many times the tokens - and the
// server refuses them regardless of what the browser offers.

import { toAiError } from '../ai/errors'
import { getSupabaseClient } from '../sync/auth'
import { ParseError } from './types'

/** Matches the server's limit. */
export const MAX_PDF_BYTES = 15 * 1024 * 1024

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/** Whether this account may send PDFs. False whenever the parser is not
 *  deployed, nobody is signed in, or the question cannot be answered - the
 *  Markdown path is always there. */
export async function pdfAllowed(): Promise<boolean> {
  const client = getSupabaseClient()
  if (!client || import.meta.env.VITE_PARSE_CAMPAIGN_DEPLOYED !== 'true') return false
  try {
    const { data, error } = await client.functions.invoke('parse-campaign', {
      body: { action: 'capabilities' },
    })
    return !error && (data as { pdf?: unknown } | null)?.pdf === true
  } catch {
    return false
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new ParseError('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

/** The transcript of one PDF. `onProgress` gets the length written so far, so
 *  a minute-long wait shows it moving. */
export async function transcribePdf(
  file: File,
  onProgress?: (characters: number) => void,
): Promise<string> {
  const client = getSupabaseClient()
  if (!client) throw new ParseError('PDF reading needs the server. Paste the text instead.')
  if (file.size > MAX_PDF_BYTES) {
    throw new ParseError('That PDF is over 15 MB. Split it, or paste the text instead.')
  }

  const { data, error } = await client.functions.invoke('parse-campaign', {
    body: { action: 'transcribe', pdf: await toBase64(file) },
  })
  if (error) {
    const failure = await toAiError(error)
    throw new ParseError(failure.code ? failure.message : `Reading the PDF failed: ${failure.message}`)
  }
  const body = (data as Response | null)?.body
  if (!body) throw new ParseError('Reading the PDF failed: the server sent nothing back.')
  return readTranscript(body, onProgress)
}

/** The server's event stream, as text: `{ text }` pieces, then `{ done }` or
 *  `{ error }`. A stream that simply stops is a failure, never a transcript -
 *  half a contract would parse as a contract with clauses missing. */
export async function readTranscript(
  body: ReadableStream<Uint8Array>,
  onProgress?: (characters: number) => void,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data === '') continue

      const event = JSON.parse(data) as { text?: unknown; done?: unknown; error?: unknown }
      if (typeof event.error === 'string') throw new ParseError(event.error)
      if (event.done === true) return text
      if (typeof event.text === 'string') {
        text += event.text
        onProgress?.(text.length)
      }
    }

    if (done) break
  }

  throw new ParseError('The PDF transcript was cut off before it finished. Try again, or paste the text instead.')
}
