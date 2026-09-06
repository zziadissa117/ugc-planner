import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { fieldLabel } from '../components/fieldLabel'
import { ACCOUNT_FIELD_KEYS, saveFieldValue } from '../data/campaignFields'
import { useData } from '../data/useData'
import {
  NEVER_PARSED_FIELDS,
  PASTE_SCHEMA_EXAMPLE,
  PastedJsonParser,
  applyParseResult,
  inspectBrief,
  verifyQuotes,
  type ParseResult,
} from '../parser'
import { EdgeFunctionParser } from '../parser/edgeFunction'

interface Upload {
  text: string
  filename: string | null
}

/** No document ever states a handle, an email or a password
 *  (NEVER_PARSED_FIELDS) - this is always typed by hand, on this screen,
 *  before a campaign can be saved at all. */
type AccountDraft = Record<(typeof ACCOUNT_FIELD_KEYS)[number], string>

const BLANK_ACCOUNT: AccountDraft = {
  platforms: '',
  handle_tiktok: '',
  handle_instagram: '',
  account_email: '',
  account_password: '',
}

function hasHandle(account: AccountDraft): boolean {
  return account.handle_tiktok.trim() !== '' || account.handle_instagram.trim() !== ''
}

export function NewCampaign() {
  const data = useData()
  const navigate = useNavigate()

  const [brief, setBrief] = useState<Upload>({ text: '', filename: null })
  const [contract, setContract] = useState<Upload>({ text: '', filename: null })
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [parsing, setParsing] = useState(false)

  const [review, setReview] = useState<ParseResult | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [account, setAccount] = useState<AccountDraft>(BLANK_ACCOUNT)

  const briefText = brief.text.trim() === '' ? null : brief.text
  const contractText = contract.text.trim() === '' ? null : contract.text

  // Computed once per render rather than cached: isAvailable() reads live
  // config (see edgeFunction.ts), and the whole point is that the deploy
  // flag can flip without a code change.
  const edgeParser = new EdgeFunctionParser()
  const serverAvailable = edgeParser.isAvailable()

  // isAvailable() means "the project is configured to reach a deployed
  // function" - a build-time fact, not "there is a network connection right
  // now." A pasted JSON always wins when present: it is the one path that
  // works with no connection at all, and CLAUDE.md's local-first rule does
  // not get to make an exception for the one screen that creates a campaign.
  // The manual box therefore always stays visible, even when the server is
  // configured - offline, or a failed server call, falls straight back to it
  // rather than requiring the user to first discover it is missing.
  const useServer = serverAvailable && json.trim() === ''

  const runParse = useCallback(async () => {
    setError(null)
    setParsing(true)
    try {
      // The server parser already ran verifyQuotes before this ever reaches
      // the browser (docs/EDGE_FUNCTION.md), but it is re-run here too rather
      // than trusted blindly - the same check, so the two paths cannot drift
      // into disagreeing about what "verified" means, and it is a no-op on an
      // already-clean result.
      const result = useServer
        ? await edgeParser.parse({ briefText, contractText })
        : await new PastedJsonParser().parse({ briefText, contractText, json })

      // The brief is inspected directly rather than taking the parser's word
      // for whether it is intact.
      const integrity = briefText === null ? null : inspectBrief(briefText)

      const verified = verifyQuotes(
        {
          ...result,
          brief_is_incomplete: (integrity?.isIncomplete ?? false) || result.brief_is_incomplete,
          warnings: [...result.warnings, ...(integrity?.reasons ?? [])],
        },
        { briefText, contractText },
      )

      setReview(verified.result)
      setRejected(verified.rejected)
      setConfirmed(new Set())
      // 'platforms' is the one account field a document sometimes states
      // (docs/EDGE_FUNCTION.md); the rest never arrive parsed and start blank.
      setAccount({
        ...BLANK_ACCOUNT,
        platforms: verified.result.fields.platforms?.value ?? '',
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setParsing(false)
    }
  }, [briefText, contractText, edgeParser, json, useServer])

  const save = useCallback(async () => {
    if (!review || !hasHandle(account)) return
    setBusy(true)
    try {
      const campaign = await applyParseResult(data, {
        result: review,
        confirmed,
        briefText,
        briefFilename: brief.filename,
        contractText,
        contractFilename: contract.filename,
      })

      // The account block is typed here, not parsed, so it goes straight in
      // as user_entered rather than through the confirm-a-quote path the rest
      // of the fields use - there is no quote to confirm.
      for (const key of ACCOUNT_FIELD_KEYS) {
        const value = account[key].trim()
        if (value !== '') await saveFieldValue(data, campaign.id, key, value)
      }

      void navigate(`/campaigns/${campaign.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [account, brief.filename, briefText, confirmed, contract.filename, contractText, data, navigate, review])

  if (review) {
    return (
      <Review
        result={review}
        rejected={rejected}
        confirmed={confirmed}
        onToggle={(key) =>
          setConfirmed((current) => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }
        onBack={() => setReview(null)}
        onSave={() => void save()}
        busy={busy}
        error={error}
        account={account}
        onAccountChange={setAccount}
      />
    )
  }

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <h1 className="text-2xl font-semibold text-text">New campaign</h1>

      <DocumentInput label="BRIEF (.md)" upload={brief} onChange={setBrief} />
      <DocumentInput label="CONTRACT (.md)" upload={contract} onChange={setContract} />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          Parsed JSON
        </h2>
        <p className="mt-1 text-sm text-state-later">
          {serverAvailable
            ? "Tap Review and the server reads the documents above for you - nothing to paste here. Offline, or if the server can't be reached, paste JSON from a model yourself below instead and it's used in place of the server."
            : 'The server parser is not deployed yet, so run the documents through a model yourself and paste what it gives back. Every field needs the exact text it came from, and anything that cannot be found in the document above is dropped.'}
        </p>
        <textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          aria-label="Parsed JSON"
          spellCheck={false}
          placeholder={PASTE_SCHEMA_EXAMPLE}
          className="mt-3 h-56 w-full resize-y rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later"
        />
      </div>

      {error ? <p className="text-state-blocked">{error}</p> : null}

      {parsing ? <ReadingProgress /> : null}

      <button
        type="button"
        onClick={() => void runParse()}
        disabled={
          parsing || (useServer ? briefText === null && contractText === null : json.trim() === '')
        }
        className="min-h-tap rounded-lg border border-state-now bg-surface-raised px-4 font-semibold text-state-now active:bg-surface disabled:border-edge disabled:bg-surface disabled:text-state-later"
      >
        {parsing ? 'Reading the documents...' : 'Review it'}
      </button>
    </section>
  )
}

/** The one wait in the app that is a real network round trip.
 *
 *  Indeterminate on purpose: the request reports no progress, so a bar filling
 *  towards a percentage would be a number nobody measured. The elapsed count
 *  is measured, so that is what it shows - enough to tell "working" from
 *  "hung" without pretending to know more than it does. */
function ReadingProgress() {
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

/** One document slot. Tap-to-pick comes first and is the biggest target:
 *  phones do not really drag and drop, and SPEC section 7 says that matters
 *  more than the drop area does. */
function DocumentInput({
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
      className={`rounded-lg border p-4 ${dragging ? 'border-state-now' : 'border-edge'}`}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">{label}</h2>

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
        className="mt-3 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
      >
        {upload.filename ?? 'Choose a file'}
      </button>

      <textarea
        value={upload.text}
        onChange={(event) => onChange({ ...upload, text: event.target.value })}
        aria-label={`${label} text`}
        spellCheck={false}
        placeholder="or paste the text here"
        className="mt-3 h-32 w-full resize-y rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later"
      />

      {upload.text.trim() === '' ? null : (
        <p className="mt-2 text-sm text-state-later">
          {upload.text.length.toLocaleString()} characters, stored as-is.
        </p>
      )}
    </div>
  )
}

function Review({
  result,
  rejected,
  confirmed,
  onToggle,
  onBack,
  onSave,
  busy,
  error,
  account,
  onAccountChange,
}: {
  result: ParseResult
  rejected: readonly string[]
  confirmed: ReadonlySet<string>
  onToggle: (key: string) => void
  onBack: () => void
  onSave: () => void
  busy: boolean
  error: string | null
  account: AccountDraft
  onAccountChange: (next: AccountDraft) => void
}) {
  const entries = Object.entries(result.fields).sort(([a], [b]) => a.localeCompare(b))
  const found = entries.filter(([, field]) => field.value !== null)
  const blank = entries.filter(([, field]) => field.value === null)

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">Review</h1>
        <p className="text-state-later">{result.campaign.name}</p>
      </header>

      <AccountEntry account={account} onChange={onAccountChange} />

      {result.brief_is_incomplete ? (
        <p className="rounded-lg border border-state-waiting/40 bg-state-waiting/10 px-4 py-3 text-state-waiting">
          This brief looks incomplete. Some rules may be missing.
        </p>
      ) : null}

      {result.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-state-waiting">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {found.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
            Found in the documents
          </h2>
          <p className="mt-1 text-sm text-state-later">
            Tap a row to confirm it against the quote. Nothing counts as a documented rate or a
            verified quota until you do.
          </p>
          <ul aria-label="Parsed fields" className="mt-3 flex flex-col gap-3">
            {found.map(([key, field]) => {
              const isConfirmed = confirmed.has(key)
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-pressed={isConfirmed}
                    className={`flex min-h-tap w-full flex-col justify-center rounded-lg border px-4 py-3 text-left active:bg-surface-raised ${
                      isConfirmed
                        ? 'border-state-posted/40 bg-state-posted/5'
                        : 'border-state-waiting/40 bg-state-waiting/5'
                    }`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-state-later">
                      {fieldLabel(key)}
                    </span>
                    <span
                      className={isConfirmed ? 'text-state-posted' : 'text-state-waiting'}
                    >
                      {field.value}
                    </span>
                    <span
                      className={`mt-1 text-xs font-semibold uppercase tracking-wide ${
                        isConfirmed ? 'text-state-posted' : 'text-state-waiting'
                      }`}
                    >
                      {isConfirmed ? 'confirmed' : 'from file - unreviewed'}
                    </span>
                    <span className="mt-1 text-xs text-state-later">"{field.source_quote}"</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {blank.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
            Not found
          </h2>
          <ul aria-label="Blank fields" className="mt-2 flex flex-col gap-1 text-sm">
            {blank.map(([key]) => (
              <li key={key} className="flex justify-between gap-4">
                <span className="text-state-later">{fieldLabel(key)}</span>
                <span className="text-state-later">
                  {rejected.includes(key) ? 'quote not in the document' : 'not saved yet'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* One plain line, so that "it did not fill that in" reads as the app
          working rather than as a bug. */}
      <p className="text-sm text-state-later">
        No document states your {NEVER_PARSED_FIELDS.slice(0, 2).join(' or ')}, setup type, real
        per-stage times or daily quota, so nothing was guessed for them. Fill them in yourself
        when you are ready.
      </p>

      {error ? <p className="text-state-blocked">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !hasHandle(account)}
          className="min-h-tap flex-1 rounded-lg border border-state-now bg-surface-raised px-4 font-semibold text-state-now active:bg-surface disabled:opacity-60"
        >
          Save campaign
        </button>
      </div>
      {!hasHandle(account) ? (
        <p className="text-right text-sm text-state-blocked">
          Add a TikTok or Instagram @ above before saving.
        </p>
      ) : null}
    </section>
  )
}

/** The account this campaign posts from, typed by hand before it can be
 *  saved at all - no document ever states a handle, an email or a password
 *  (NEVER_PARSED_FIELDS), so there is nothing to parse here and nothing to
 *  confirm against a quote. At least one @ is required: a campaign with
 *  nothing to log into and post from is not a working campaign yet. */
function AccountEntry({
  account,
  onChange,
}: {
  account: AccountDraft
  onChange: (next: AccountDraft) => void
}) {
  const [showPassword, setShowPassword] = useState(false)
  const set = (key: keyof AccountDraft) => (value: string) => onChange({ ...account, [key]: value })

  return (
    <div className="rounded-lg border border-edge bg-surface p-4">
      <h2 className="text-lg font-semibold text-text">Account</h2>
      <p className="mt-1 text-sm text-state-later">
        No document ever states a handle, an email or a password - type them in. At least one @ is
        required before this campaign can be saved.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <AccountInput label="Platform" value={account.platforms} onChange={set('platforms')} />
        <AccountInput
          label="TikTok @"
          value={account.handle_tiktok}
          onChange={set('handle_tiktok')}
        />
        <AccountInput
          label="Instagram @"
          value={account.handle_instagram}
          onChange={set('handle_instagram')}
        />
        <AccountInput
          label="Email"
          type="email"
          value={account.account_email}
          onChange={set('account_email')}
        />
        <div>
          <label htmlFor="new-account-password" className="text-sm text-state-later">
            Password
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="new-account-password"
              value={account.account_password}
              onChange={(event) => set('account_password')(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="min-h-tap shrink-0 rounded-lg border border-edge px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  const id = `new-account-${label}`
  return (
    <div>
      <label htmlFor={id} className="text-sm text-state-later">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        className="mt-1 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text"
      />
    </div>
  )
}
