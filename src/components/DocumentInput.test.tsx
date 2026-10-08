import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentInput, type Upload } from './DocumentInput'

function Harness({ readPdf }: { readPdf?: (file: File, onProgress: (n: number) => void) => Promise<string> }) {
  const [upload, setUpload] = useState<Upload>({ text: '', filename: null })
  return <DocumentInput label="CONTRACT (.md)" upload={upload} onChange={setUpload} readPdf={readPdf} />
}

const pdfFile = () => new File(['%PDF-1.7 binary'], 'contract.pdf', { type: 'application/pdf' })

describe('a PDF in the document slot', () => {
  it('is refused in words, not read as text, when the account has no PDF reading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<Harness />)

    await user.upload(screen.getByLabelText('CONTRACT (.md) file'), pdfFile())

    expect(await screen.findByText(/PDFs are not read on this account/)).toBeInTheDocument()
    expect(screen.getByLabelText('CONTRACT (.md) text')).toHaveValue('')
  })

  it('fills the box with the transcript and says Claude wrote it out', async () => {
    const user = userEvent.setup()
    let finish: (text: string) => void = () => {}
    const readPdf = vi.fn((_file: File, onProgress: (n: number) => void) => {
      onProgress(120)
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    })
    render(<Harness readPdf={readPdf} />)

    await user.upload(screen.getByLabelText('CONTRACT (.md) file'), pdfFile())

    // While it is being written out, the wait is visible and counted.
    expect(await screen.findByRole('status', { name: 'Reading the PDF' })).toHaveTextContent('120 characters so far')
    expect(screen.getByRole('button', { name: /Reading contract\.pdf/ })).toBeDisabled()

    finish('Compensation: $35.00 per approved deliverable.')
    await waitFor(() =>
      expect(screen.getByLabelText('CONTRACT (.md) text')).toHaveValue('Compensation: $35.00 per approved deliverable.'),
    )
    expect(screen.getByText(/Written out from the PDF by Claude/)).toBeInTheDocument()
  })

  it('shows why reading failed and leaves the box as it was', async () => {
    const user = userEvent.setup()
    render(<Harness readPdf={() => Promise.reject(new Error('Your saved API key was rejected.'))} />)

    await user.upload(screen.getByLabelText('CONTRACT (.md) file'), pdfFile())

    expect(await screen.findByText('Your saved API key was rejected.')).toBeInTheDocument()
    expect(screen.getByLabelText('CONTRACT (.md) text')).toHaveValue('')
  })
})
