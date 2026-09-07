import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { KNOWN_PLATFORMS } from '../components/AccountsEditor'
import { DocumentInput, type Upload } from '../components/DocumentInput'
import { fieldLabel } from '../components/fieldLabel'
import { ReadingProgress } from '../components/ReadingProgress'
import {
  centsToDollarsInput,
  parseDollarsToCents,
  saveFieldValue,
} from '../data/campaignFields'
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

/** One platform this campaign will post to. No document ever states a handle,
 *  an email or a password (NEVER_PARSED_FIELDS), so these are typed here and
 *  become campaign_accounts rows - one per platform, each with its own login,
 *  rather than one set of credentials smeared across the campaign. */
interface PlatformDraft {
  platform: string
  handle: string
  email: string
  password: string
}

function blankPlatform(platform: string): PlatformDraft {
  return { platform, handle: '', email: '', password: '' }
}

/** Platforms a brief mentioned, matched against the ones the app knows. The
 *  parser is allowed to state platforms; it is not allowed to invent one, so
 *  anything it says that is not recognised is simply not pre-selected. */
function platformsFromBrief(stated: string | null): string[] {
  if (stated === null) return []
  const lower = stated.toLowerCase()
  return KNOWN_PLATFORMS.filter((name) => lower.includes(name.toLowerCase()))
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
  const [platforms, setPlatforms] = useState<PlatformDraft[]>([])
  /** Paid deliverables a day. No document states it, and without it the
   *  campaign owes nothing and pays nothing - so it is asked for here, with
   *  one a day as the starting point rather than a guess at his contract. */
  const [quota, setQuota] = useState('1')
  /** What one deliverable pays, in dollars as typed. Seeded from the contract
   *  when it states a rate, and blank when it does not - a campaign whose rate
   *  no document mentions had no way to get one at creation, so it landed on
   *  the brief page reading "no rate yet" and stayed there. */
  const [rate, setRate] = useState('')

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
      // 'platforms' is the one account fact a document sometimes states
      // (docs/EDGE_FUNCTION.md), so the ones it names are pre-selected. The
      // handles and logins never arrive parsed and start blank.
      setPlatforms(
        platformsFromBrief(verified.result.fields.platforms?.value ?? null).map(blankPlatform),
      )
      // Whatever the contract said, shown in dollars so he can correct it
      // rather than discover it later. Blank when it said nothing: an empty
      // box is a question, and a guessed rate would be an answer.
      const parsedRate = verified.result.fields.pay_per_video_cents?.value ?? null
      const parsedCents = parsedRate === null ? null : Number(parsedRate)
      setRate(
        parsedCents !== null && Number.isSafeInteger(parsedCents)
          ? centsToDollarsInput(parsedCents)
          : '',
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setParsing(false)
    }
  }, [briefText, contractText, edgeParser, json, useServer])

  const save = useCallback(async () => {
    if (!review) return
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

      const owed = Number(quota)
      if (Number.isInteger(owed) && owed >= 0) {
        await data.updateCampaign(campaign.id, { daily_post_quota: owed })
      }

      // Only when it differs from what the parse produced, so confirming a
      // documented rate and leaving the box alone does not rewrite it as
      // something he typed. Through saveFieldValue, so the provenance row and
      // the column the app plans against move together.
      const cents = parseDollarsToCents(rate)
      if (cents !== null && cents !== campaign.pay_per_video_cents) {
        await saveFieldValue(data, campaign.id, 'pay_per_video_cents', String(cents))
      }

      // One row per platform, each carrying its own login. Typed here, never
      // parsed, so nothing is confirmed against a quote.
      let order = 0
      for (const draft of platforms) {
        await data.addCampaignAccount({
          campaign_id: campaign.id,
          platform: draft.platform,
          handle: draft.handle.trim() === '' ? null : draft.handle.trim(),
          email: draft.email.trim() === '' ? null : draft.email.trim(),
          password: draft.password === '' ? null : draft.password,
          status: 'new',
          sort_order: order++,
        })
      }

      void navigate(`/campaigns/${campaign.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [
    brief.filename,
    briefText,
    confirmed,
    contract.filename,
    contractText,
    data,
    navigate,
    platforms,
    quota,
    rate,
    review,
  ])

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
        platforms={platforms}
        onPlatformsChange={setPlatforms}
        quota={quota}
        onQuotaChange={setQuota}
        rate={rate}
        onRateChange={setRate}
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

function Review({
  result,
  rejected,
  confirmed,
  onToggle,
  onBack,
  onSave,
  busy,
  error,
  platforms,
  onPlatformsChange,
  quota,
  onQuotaChange,
  rate,
  onRateChange,
}: {
  result: ParseResult
  rejected: readonly string[]
  confirmed: ReadonlySet<string>
  onToggle: (key: string) => void
  onBack: () => void
  onSave: () => void
  busy: boolean
  error: string | null
  platforms: PlatformDraft[]
  onPlatformsChange: (next: PlatformDraft[]) => void
  quota: string
  onQuotaChange: (next: string) => void
  rate: string
  onRateChange: (next: string) => void
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

      <PlatformEntry
        platforms={platforms}
        onChange={onPlatformsChange}
        quota={quota}
        onQuotaChange={onQuotaChange}
        rate={rate}
        onRateChange={onRateChange}
      />

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
          disabled={busy}
          className="min-h-tap flex-1 rounded-lg border border-state-now bg-surface-raised px-4 font-semibold text-state-now active:bg-surface disabled:opacity-60"
        >
          Save campaign
        </button>
      </div>
    </section>
  )
}

/** Where this campaign posts, and how much it owes a day.
 *
 *  Platforms are picked, not typed, and each carries its own handle, email and
 *  password on one line. Nothing here blocks saving: a campaign with no
 *  platform yet is a campaign he can add one to on the brief page, and being
 *  refused at the last step of a long parse is worse than an incomplete row. */
function PlatformEntry({
  platforms,
  onChange,
  quota,
  onQuotaChange,
  rate,
  onRateChange,
}: {
  platforms: PlatformDraft[]
  onChange: (next: PlatformDraft[]) => void
  quota: string
  onQuotaChange: (next: string) => void
  rate: string
  onRateChange: (next: string) => void
}) {
  const chosen = new Set(platforms.map((p) => p.platform))

  const toggle = (name: string) => {
    onChange(
      chosen.has(name)
        ? platforms.filter((p) => p.platform !== name)
        : [...platforms, blankPlatform(name)],
    )
  }

  const set = (platform: string, key: keyof PlatformDraft) => (value: string) =>
    onChange(platforms.map((p) => (p.platform === platform ? { ...p, [key]: value } : p)))

  return (
    <div className="rounded-lg border border-edge bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          Where it posts
        </h2>
        {/* The two numbers that decide what the campaign owes and what it
            pays. Both live here rather than only on the brief page: he
            reported that creating a campaign gave him no way to say what it
            pays, so it read "no rate yet" from the moment it was saved. */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-state-later">
            $ per post
            <input
              value={rate}
              onChange={(event) => onRateChange(event.target.value)}
              aria-label="Dollars per post"
              inputMode="decimal"
              placeholder="35"
              className="min-h-tap w-20 rounded-md border border-edge bg-surface-raised px-2 text-text placeholder:text-state-later"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-state-later">
            posts owed per day
            <input
              value={quota}
              onChange={(event) => onQuotaChange(event.target.value)}
              aria-label="Posts owed per day"
              inputMode="numeric"
              className="min-h-tap w-16 rounded-md border border-edge bg-surface-raised px-2 text-text"
            />
          </label>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {KNOWN_PLATFORMS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            aria-pressed={chosen.has(name)}
            className={[
              'min-h-tap rounded-md border px-3 text-sm font-semibold active:bg-surface',
              chosen.has(name)
                ? 'border-state-now bg-surface-raised text-state-now'
                : 'border-edge bg-surface text-state-later',
            ].join(' ')}
          >
            {name}
          </button>
        ))}
      </div>

      {platforms.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {platforms.map((draft) => (
            <li key={draft.platform} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 shrink-0 text-sm font-semibold text-text">
                {draft.platform}
              </span>
              <input
                value={draft.handle}
                onChange={(event) => set(draft.platform, 'handle')(event.target.value)}
                aria-label={`${draft.platform} handle`}
                placeholder="@handle"
                className="min-h-tap w-28 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
              />
              <input
                value={draft.email}
                onChange={(event) => set(draft.platform, 'email')(event.target.value)}
                aria-label={`${draft.platform} email`}
                placeholder="email"
                autoComplete="off"
                className="min-h-tap w-32 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
              />
              <input
                value={draft.password}
                onChange={(event) => set(draft.platform, 'password')(event.target.value)}
                type="password"
                aria-label={`${draft.platform} password`}
                placeholder="password"
                autoComplete="new-password"
                className="min-h-tap w-28 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-state-later">
          None picked yet. You can add them on the brief afterwards.
        </p>
      )}
    </div>
  )
}
