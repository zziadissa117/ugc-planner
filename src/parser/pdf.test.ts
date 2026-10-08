import { describe, expect, it } from 'vitest'

import { isPdf, readTranscript } from './pdf'

/** A byte stream that delivers `chunks` one read at a time, the way a slow
 *  network splits the server's events wherever it likes. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`

describe('reading a PDF transcript off the server', () => {
  it('joins the pieces in order and stops at done', async () => {
    const whole = event({ text: '# Agreement\n' }) + event({ text: '$35.00 per deliverable' }) + event({ done: true, model: 'm' })
    const progress: number[] = []
    // Split mid-event, and mid-way through the dollar sign's line.
    const text = await readTranscript(streamOf([whole.slice(0, 9), whole.slice(9, 40), whole.slice(40)]), (n) =>
      progress.push(n),
    )
    expect(text).toBe('# Agreement\n$35.00 per deliverable')
    expect(progress).toEqual([12, 34])
  })

  it('fails with the server\'s own reason', async () => {
    await expect(
      readTranscript(streamOf([event({ text: 'part' }), event({ error: 'The PDF is too long to write out in one go.' })])),
    ).rejects.toThrow('The PDF is too long to write out in one go.')
  })

  it('never hands back half a contract when the stream just stops', async () => {
    await expect(readTranscript(streamOf([event({ text: 'Clause 1. ' })]))).rejects.toThrow(/cut off/)
  })
})

describe('isPdf', () => {
  it('goes by type or by name', () => {
    expect(isPdf(new File(['x'], 'contract.PDF'))).toBe(true)
    expect(isPdf(new File(['x'], 'contract', { type: 'application/pdf' }))).toBe(true)
    expect(isPdf(new File(['x'], 'contract.md', { type: 'text/markdown' }))).toBe(false)
  })
})
