// Turning a PDF into text the quote check can hold the parser to.
//
// The parser's whole safety rests on verifyQuotes: a value survives only if
// its quote is found, word for word, in the document text. A PDF has no text
// of its own to check against, so it is transcribed first - Claude reads the
// PDF and writes it out as Markdown - and that transcript then goes through
// the ordinary parse exactly as a pasted .md file would. The transcript is
// what gets stored and what every quote is checked against; the app says so
// wherever it shows one.
//
// Its own request, streamed. A long contract takes a minute or more to write
// out, and Supabase cuts any request that sends nothing for 150 seconds, so
// the transcript is passed through as it is written (server-sent events)
// rather than returned at the end. Parsing it is then a second, separate
// request with the text, which keeps each one well inside the limits.
//
// Owner only (_shared/owner.ts): a PDF costs many times the tokens of the same
// contract pasted as Markdown.

import { CORS_HEADERS, MESSAGES_URL, messagesHeaders, modelErrorFor } from './claude.ts'

// Supabase's runtime global. Its published type file is a module, so the
// declaration does not reach here; this is the one method used.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

/** The largest PDF accepted, in bytes. Claude takes requests up to 32 MB and
 *  base64 adds a third, so this leaves room; a contract is rarely over 2 MB. */
export const MAX_PDF_BYTES = 15 * 1024 * 1024

const SYSTEM = `You transcribe a PDF into Markdown, exactly as it is written.

The transcript is the only text anyone will check this document against: every value later taken from it must be found in it word for word. So:
- Copy every word, number, currency symbol, date, percentage and punctuation mark exactly as printed. Do not correct spelling, grammar or formatting, and do not reword anything.
- Keep the reading order. Use Markdown headings for headings, lists for lists, and Markdown tables for tables, one row per printed row.
- Leave out only repeated page furniture: running headers and footers, and page numbers. Keep everything else, including small print, footnotes and signature blocks.
- Where something cannot be read, write [illegible] in its place rather than guessing. Write [signature] for a signature and [image] for a picture with no text.
- Output only the transcript: no introduction, no summary, no comments.`

interface StreamEvent {
  type?: string
  message?: { model?: string }
  delta?: { type?: string; text?: string; stop_reason?: string | null }
  error?: { message?: string }
}

/** Server-sent events from a byte stream, one parsed `data:` payload at a
 *  time. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value.replace(/\r\n/g, '\n')
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data !== '') yield JSON.parse(data) as StreamEvent
    }
  }
}

function why(stop: string | null): string {
  if (stop === 'max_tokens') return 'The PDF is too long to write out in one go. Split it, or paste the text instead.'
  if (stop === 'refusal') return 'The model declined to read this PDF.'
  return `The transcript stopped early (${stop ?? 'no reason given'}). Try again, or paste the text instead.`
}

/** Streams the transcript of one PDF back to the browser as server-sent
 *  events: `{ text }` for each piece as it is written, then exactly one of
 *  `{ done: true, model }` or `{ error }`. A failure before anything is
 *  written throws a ModelError instead, so it gets a real status code. */
export async function streamTranscript(call: {
  apiKey: string
  model: string
  pdfBase64: string
}): Promise<Response> {
  const upstream = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: messagesHeaders(call.apiKey),
    body: JSON.stringify({
      model: call.model,
      // A 30-page contract is well under this. Streaming means a long one is
      // not a timeout risk, only a wait.
      max_tokens: 64000,
      fallbacks: 'default',
      stream: true,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: call.pdfBase64 } },
            { type: 'text', text: 'Transcribe this document.' },
          ],
        },
      ],
      // Copying out text needs no deliberation; low effort keeps it fast.
      output_config: { effort: 'low' },
    }),
  })

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text()
    throw modelErrorFor(upstream.status, detail, upstream.headers.get('retry-after'))
  }

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const send = (payload: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

  const pump = (async () => {
    let model = call.model
    let stop: string | null = null
    let failure: string | null = null
    try {
      for await (const event of events(upstream.body!)) {
        if (event.type === 'message_start' && event.message?.model) model = event.message.model
        else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          await send({ text: event.delta.text })
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) stop = event.delta.stop_reason
        else if (event.type === 'error') failure = event.error?.message ?? 'The model stream failed.'
      }
    } catch (err) {
      failure = (err as Error).message
    }
    try {
      if (failure !== null) await send({ error: `Reading the PDF failed: ${failure}` })
      else if (stop !== 'end_turn') await send({ error: why(stop) })
      else await send({ done: true, model })
      await writer.close()
    } catch {
      // The browser went away; there is nobody left to tell.
    }
  })()

  // Keeps the worker alive while the transcript is still being passed on.
  EdgeRuntime.waitUntil(pump)

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      // event-stream, not plain text: proxies pass it through unbuffered, and
      // supabase-js hands the browser the live response instead of waiting.
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
