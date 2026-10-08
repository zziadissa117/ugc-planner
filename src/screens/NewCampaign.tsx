import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { KNOWN_PLATFORMS } from '../components/platforms'
import { DocumentInput, type Upload } from '../components/DocumentInput'
import { fieldLabel } from '../components/fieldLabel'
import { CheckIcon } from '../components/icons'
import { ReadingProgress } from '../components/ReadingProgress'
import { INPUT_CLASS } from '../components/styles'
import { Disclosure, SectionLabel, StateDot } from '../components/ui'
import {
  MONEY_FIELDS,
  centsToDollarsInput,
  parseDollarsToCents,
  saveFieldValue,
} from '../data/campaignFields'
import { useData } from '../data/useData'
import {
  PASTE_SCHEMA_EXAMPLE,
  PastedJsonParser,
  applyParseResult,
  inspectBrief,
  valueIsInQuote,
  verifyQuotes,
  type ParseResult,
} from '../parser'
import { formatCents } from '../money'
import { EdgeFunctionParser } from '../parser/edgeFunction'
import { usePdfReading } from '../parser/usePdfReading'

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

  /** Typing the campaign in by hand, with no document involved at all. */
  const [manual, setManual] = useState(false)
  const [name, setName] = useState('')

  const [review, setReview] = useState<ParseResult | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  /** Rules and bonus tiers he unticked on the review screen, by index. */
  const [excludedRules, setExcludedRules] = useState<Set<number>>(new Set())
  const [excludedTiers, setExcludedTiers] = useState<Set<number>>(new Set())
  const [platforms, setPlatforms] = useState<PlatformDraft[]>([])
  /** Paid deliverables a WEEK. No document states it, and without it the
   *  campaign owes nothing and pays nothing - so it is asked for here, with
   *  one a day (seven) as the starting point rather than a guess at his
   *  contract. */
  const [quota, setQuota] = useState('7')
  /** What one deliverable pays, in dollars as typed. Seeded from the contract
   *  when it states a rate, and blank when it does not - a campaign whose rate
   *  no document mentions had no way to get one at creation, so it landed on
   *  the brief page reading "no rate yet" and stayed there. */
  const [rate, setRate] = useState('')
  /** The working brief for the hook writer, as the model wrote it from the
   *  documents. Editable on the review screen; blank saves nothing. */
  const [hookBrief, setHookBrief] = useState('')

  const briefText = brief.text.trim() === '' ? null : brief.text
  const contractText = contract.text.trim() === '' ? null : contract.text

  // Computed once per render rather than cached: isAvailable() reads live
  // config (see edgeFunction.ts), and the whole point is that the deploy
  // flag can flip without a code change.
  // One instance for the life of the screen, so the callbacks that use it
  // are not rebuilt on every keystroke.
  const edgeParser = useMemo(() => new EdgeFunctionParser(), [])
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
  // PDF contracts are the owner's alone; everyone else gets the .md slots.
  const pdf = usePdfReading(serverAvailable)

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
      // Everything that survived the quote check starts accepted: he pasted
      // the contract to have it filled in, and a value whose line was found
      // in the document is the contract's word, not a guess. One Save takes
      // the lot; unticking one leaves it unchecked on the campaign.
      setConfirmed(
        new Set(
          Object.entries(verified.result.fields)
            .filter(([, field]) => field.value !== null && field.source_quote !== null)
            .map(([key]) => key),
        ),
      )
      setExcludedRules(new Set())
      setExcludedTiers(new Set())
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
      // The weekly count, when the documents state one. Only a starting point
      // in an editable box: the seven a week it otherwise starts at is a
      // placeholder, and a stated number is better than that. Never applied
      // behind his back - it is what the box says when he looks at it.
      const parsedWeekly = verified.result.fields.posts_per_week?.value ?? null
      if (parsedWeekly !== null && /^\d+$/.test(parsedWeekly)) setQuota(parsedWeekly)
      setHookBrief(verified.result.hook_brief?.trim() ?? '')
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
        excludedRules,
        excludedTiers,
        hookBrief,
      })

      const owed = Number(quota)
      if (Number.isInteger(owed) && owed >= 0) {
        await data.updateCampaign(campaign.id, { posts_per_week: owed })
      }

      // Only when it differs from what the parse produced, so accepting a
      // documented rate and leaving the box alone does not rewrite it as
      // something he typed - and unticking the rate and leaving the box alone
      // leaves it unchecked rather than quietly making it his. Through
      // saveFieldValue, so the provenance row and the column the app plans
      // against move together.
      const cents = parseDollarsToCents(rate)
      const parsedRate = review.fields.pay_per_video_cents?.value ?? null
      const untouchedParsedRate = parsedRate !== null && cents === Number(parsedRate)
      if (cents !== null && cents !== campaign.pay_per_video_cents && !untouchedParsedRate) {
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
    excludedRules,
    excludedTiers,
    hookBrief,
    navigate,
    platforms,
    quota,
    rate,
    review,
  ])

  /** The whole campaign, typed. No brief, no contract, no parse - he knows
   *  what it pays and where it posts, and asking him to produce a document
   *  before he can say so was the app doubting him. */
  const saveManual = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const owed = Number(quota)
      const campaign = await data.createCampaign({
        name: name.trim(),
        company: null,
        default_setup: 'face',
        posts_per_week: Number.isInteger(owed) && owed >= 0 ? owed : 0,
        pay_per_video_cents: null,
        cycle_size: null,
      })

      // Through the field row as well as the column, so the brief shows his
      // rate as his rather than beside "not saved yet".
      const cents = parseDollarsToCents(rate)
      if (cents !== null) {
        await saveFieldValue(data, campaign.id, 'pay_per_video_cents', String(cents))
      }

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
  }, [data, name, navigate, platforms, quota, rate])

  if (manual) {
    return (
      <section className="mx-auto flex max-w-screen-sm flex-col gap-4">
        <h1 className="text-[1.625rem] font-semibold leading-tight tracking-[-0.015em] text-text">New campaign</h1>

        <label className="flex flex-col gap-1">
          <span className="label text-state-later">
            Campaign name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Campaign name"
            placeholder="Inflow"
            className="min-h-tap rounded-xl border border-edge bg-surface text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none px-3"
          />
        </label>

        <PlatformEntry
          platforms={platforms}
          onChange={setPlatforms}
          quota={quota}
          onQuotaChange={setQuota}
          rate={rate}
          onRateChange={setRate}
        />

        <p className="text-sm text-state-later">
          A brief or contract can be read in later from the campaign page, and hooks and the
          creative brief live in FILM.
        </p>

        {error ? <p className="text-state-blocked">{error}</p> : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setManual(false)}
            className="flex-1 min-h-tap rounded-xl border border-transparent px-4 font-semibold text-state-later press inline-flex items-center justify-center gap-2 active:bg-surface"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void saveManual()}
            disabled={busy || name.trim() === ''}
            className="flex-1 min-h-tap rounded-xl border border-state-now/80 bg-surface px-4 font-semibold text-state-now lit press inline-flex items-center justify-center gap-2 active:bg-surface-raised disabled:border-edge disabled:text-state-later disabled:shadow-none"
          >
            Save campaign
          </button>
        </div>
      </section>
    )
  }

  if (review) {
    return (
      <Review
        result={review}
        rejected={rejected}
        documents={briefText !== null && contractText !== null ? 'documents' : briefText !== null ? 'brief' : 'contract'}
        confirmed={confirmed}
        onToggle={(key) =>
          setConfirmed((current) => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }
        excludedRules={excludedRules}
        onToggleRule={(index) => setExcludedRules((current) => toggled(current, index))}
        excludedTiers={excludedTiers}
        onToggleTier={(index) => setExcludedTiers((current) => toggled(current, index))}
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
        hookBrief={hookBrief}
        onHookBriefChange={setHookBrief}
      />
    )
  }

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-7">
      <h1 className="text-[1.625rem] font-semibold leading-tight tracking-[-0.015em] text-text">New campaign</h1>

      {/* First, and on its own, because it is the baseline rather than the
          fallback: he knows the rate and the platforms, and reading documents
          is a shortcut for when there are documents. */}
      <button
        type="button"
        onClick={() => setManual(true)}
        className="min-h-tap rounded-xl border border-state-now/80 bg-surface px-4 font-semibold text-state-now lit press inline-flex items-center justify-center gap-2 active:bg-surface-raised disabled:border-edge disabled:text-state-later disabled:shadow-none"
      >
        Type it in myself
      </button>

      <p className="meta -mt-3 text-state-later">
        Or drop the brief and contract below and have them read for you.
      </p>

      <DocumentInput
        label={`BRIEF (${pdf.kinds})`}
        upload={brief}
        onChange={setBrief}
        readPdf={pdf.readPdf}
        onReadingChange={pdf.setBriefReading}
      />
      <DocumentInput
        label={`CONTRACT (${pdf.kinds})`}
        upload={contract}
        onChange={setContract}
        readPdf={pdf.readPdf}
        onReadingChange={pdf.setContractReading}
      />

      <div>
        <h2 className="label text-state-later">
          Parsed JSON
        </h2>
        <p className="meta mt-1 text-state-later">
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
          className="mt-3 h-56 w-full resize-y rounded-xl border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none"
        />
      </div>

      {error ? <p className="text-state-blocked">{error}</p> : null}

      {parsing ? <ReadingProgress /> : null}

      <button
        type="button"
        onClick={() => void runParse()}
        disabled={
          parsing ||
          pdf.reading ||
          (useServer ? briefText === null && contractText === null : json.trim() === '')
        }
        className="min-h-tap rounded-xl border border-state-now/80 bg-surface px-4 font-semibold text-state-now lit press inline-flex items-center justify-center gap-2 active:bg-surface-raised disabled:border-edge disabled:text-state-later disabled:shadow-none"
      >
        {parsing ? 'Reading the documents...' : 'Review it'}
      </button>
    </section>
  )
}

function toggled(set: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(set)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  return next
}

/** Field keys whose value is a whole number, matched against the numbers in
 *  their quote rather than as text. */
const COUNT_FIELDS: readonly string[] = [
  'cycle_size',
  'base_comp_cap',
  'post_public_days',
  'revision_rounds',
  'minimum_length_seconds',
  'posts_per_week',
  'min_views_to_be_paid',
]

function kindOf(key: string): 'money' | 'count' | 'text' {
  if (MONEY_FIELDS.includes(key)) return 'money'
  if (COUNT_FIELDS.includes(key)) return 'count'
  return 'text'
}

function Review({
  result,
  rejected,
  documents,
  confirmed,
  onToggle,
  excludedRules,
  onToggleRule,
  excludedTiers,
  onToggleTier,
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
  hookBrief,
  onHookBriefChange,
}: {
  result: ParseResult
  rejected: readonly string[]
  /** What was read, for the two list headings: "From the contract", "Not in
   *  the brief". */
  documents: 'brief' | 'contract' | 'documents'
  confirmed: ReadonlySet<string>
  onToggle: (key: string) => void
  excludedRules: ReadonlySet<number>
  onToggleRule: (index: number) => void
  excludedTiers: ReadonlySet<number>
  onToggleTier: (index: number) => void
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
  hookBrief: string
  onHookBriefChange: (next: string) => void
}) {
  const entries = Object.entries(result.fields).sort(([a], [b]) => a.localeCompare(b))
  const blank = entries.filter(([, field]) => field.value === null)

  // Every found value starts ticked and goes in with the one Save. The order
  // is where his attention is worth most: a value that can be read straight
  // off its quote is a glance, while one the parser summarised, or flagged
  // with a note, is something to actually read - so those come first.
  const needsReading = (key: string, field: ParseResult['fields'][string]) =>
    (field.note ?? null) !== null || !valueIsInQuote(field.value, field.source_quote, kindOf(key))
  const found = entries
    .filter(([, field]) => field.value !== null)
    .sort(([ka, a], [kb, b]) => Number(needsReading(kb, b)) - Number(needsReading(ka, a)))
  const ticked = found.filter(([key]) => confirmed.has(key)).length

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-7">
      <header>
        <h1 className="text-[1.625rem] font-semibold leading-tight tracking-[-0.015em] text-text">Review</h1>
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
        <p className="border-l-2 border-state-waiting pl-3 text-base text-state-waiting">
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
          <SectionLabel trailing={`${ticked} of ${found.length} ticked`}>From the {documents}</SectionLabel>
          <p className="meta mt-1 text-state-later">
            Each value was checked against the line it came from. Save accepts everything ticked -
            untick anything wrong and it stays unchecked on the campaign.
          </p>
          <ul aria-label="Parsed fields" className="mt-1 flex flex-col divide-y divide-rule">
            {found.map(([key, field]) => {
              const isTicked = confirmed.has(key)
              const value = field.value ?? ''
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-pressed={isTicked}
                    className="press flex w-full gap-3 py-3 text-left active:bg-surface"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                        isTicked ? 'border-text text-text' : 'border-edge-lit'
                      }`}
                    >
                      {isTicked ? <CheckIcon className="draw-check h-4 w-4" strokeWidth={2.25} /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="label text-state-later">{fieldLabel(key)}</span>
                        <span className="label shrink-0 text-state-later">
                          {isTicked ? 'accepted' : 'left unchecked'}
                        </span>
                      </span>
                      <span
                        className={`text-lg leading-snug ${
                          isTicked ? 'text-text' : 'text-state-later line-through decoration-state-later/60'
                        }`}
                      >
                        {kindOf(key) === 'money' && /^\d+$/.test(value) ? formatCents(Number(value)) : value}
                      </span>
                      {field.note ? (
                        <span className="mt-1 text-sm text-state-waiting">Check: {field.note}</span>
                      ) : null}
                      <span className="meta mt-1 text-state-later">
                        {valueIsInQuote(field.value, field.source_quote, kindOf(key))
                          ? 'Word for word: '
                          : 'Summarised from: '}
                        "{field.source_quote}"
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {result.rules.length > 0 ? (
        <div>
          <h2 className="label text-state-later">
            Never-do rules found - {result.rules.length - excludedRules.size} kept
          </h2>
          <p className="meta mt-1 text-state-later">
            Each one is quoted from your documents. Tap one to leave it out.
          </p>
          <ul aria-label="Parsed rules" className="mt-3 flex flex-col gap-2">
            {result.rules.map((rule, index) => {
              const kept = !excludedRules.has(index)
              return (
                <li key={`${index}:${rule.body}`}>
                  <button
                    type="button"
                    onClick={() => onToggleRule(index)}
                    aria-pressed={kept}
                    className={`press flex min-h-tap w-full flex-col justify-center border-l pl-3 pr-1 py-2 text-left active:bg-surface ${
                      kept ? 'border-state-blocked/70' : 'border-edge'
                    }`}
                  >
                    <span className={kept ? 'text-text' : 'text-state-later line-through'}>
                      {rule.body}
                    </span>
                    <span className="meta mt-1 text-state-later">"{rule.source_quote}"</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {result.bonus_tiers.length > 0 ? (
        <div>
          <h2 className="label text-state-later">
            Bonus tiers found
          </h2>
          <p className="meta mt-1 text-state-later">
            Each line was found in the contract and states both numbers. Tap one to leave it out.
          </p>
          <ul aria-label="Parsed bonus tiers" className="mt-3 flex flex-col gap-2">
            {result.bonus_tiers.map((tier, index) => {
              const kept = !excludedTiers.has(index)
              return (
                <li key={`${index}:${tier.threshold_views}`}>
                  <button
                    type="button"
                    onClick={() => onToggleTier(index)}
                    aria-pressed={kept}
                    className="press flex min-h-tap w-full flex-col justify-center rounded-xl border border-edge px-3 py-2 text-left active:bg-surface"
                  >
                    <span className={`numeric ${kept ? 'text-text' : 'text-state-later line-through'}`}>
                      {tier.threshold_views.toLocaleString()} views - {formatCents(tier.payout_cents)}
                      {tier.view_window_days === null ? '' : ` within ${tier.view_window_days} days`}
                    </span>
                    <span className="meta mt-1 text-state-later">"{tier.source_quote}"</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {result.hook_brief !== undefined && result.hook_brief !== null ? (
        // Folded: it is a page of Claude's own writing, not a value from the
        // contract, and it can be read and fixed later in FILM's Creative
        // brief just as well as here.
        <Disclosure summary="Brief for the hook writer" trailing="written by Claude" className="border-t">
          <p className="meta text-state-later">
            Claude wrote this from your documents, so it is not a quote and nothing here is
            checked. It is saved as unchecked and goes to the hook writer as-is - clear the box to
            save none. It ends with what the documents do not say.
          </p>
          <textarea
            value={hookBrief}
            onChange={(event) => onHookBriefChange(event.target.value)}
            aria-label="Brief for the hook writer"
            className={`${INPUT_CLASS} mt-2 h-64 w-full resize-y py-3 font-mono text-xs`}
          />
        </Disclosure>
      ) : null}

      {blank.length > 0 ? (
        <div>
          <SectionLabel trailing={blank.length}>Not in the {documents}</SectionLabel>
          <ul aria-label="Blank fields" className="mt-2 flex flex-col gap-1.5 text-base">
            {blank.map(([key]) => (
              <li key={key} className="flex items-center gap-3">
                <StateDot tone="later" />
                <span className="min-w-0 flex-1 text-state-later">{fieldLabel(key)}</span>
                {rejected.includes(key) ? (
                  <span className="meta shrink-0 text-state-later">its quote was not in the document</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="meta mt-3 text-state-later">
            Left blank rather than guessed. Logins and handles are never in a contract - they go in
            Where it posts above.
          </p>
        </div>
      ) : (
        <p className="meta text-state-later">
          Logins and handles are never in a contract - they go in Where it posts above.
        </p>
      )}

      {error ? <p className="text-state-blocked">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 min-h-tap rounded-xl border border-transparent px-4 font-semibold text-state-later press inline-flex items-center justify-center gap-2 active:bg-surface"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="flex-1 min-h-tap rounded-xl border border-state-now/80 bg-surface px-4 font-semibold text-state-now lit press inline-flex items-center justify-center gap-2 active:bg-surface-raised disabled:border-edge disabled:text-state-later disabled:shadow-none"
        >
          Save campaign
        </button>
      </div>
    </section>
  )
}

/** Where this campaign posts, and how much it owes a week.
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
    <div className="rounded-2xl border border-rule p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="label text-state-later">
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
              className="min-h-tap rounded-xl border border-edge bg-surface text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none w-20 px-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-state-later">
            posts owed per week
            <input
              value={quota}
              onChange={(event) => onQuotaChange(event.target.value)}
              aria-label="Posts owed per week"
              inputMode="numeric"
              className="min-h-tap rounded-xl border border-edge bg-surface text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none w-16 px-2"
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
              'press min-h-11 rounded-full border px-4 text-sm font-semibold active:bg-surface',
              chosen.has(name)
                ? 'border-state-now bg-surface text-state-now'
                : 'border-edge text-state-later',
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
                className="min-h-tap rounded-xl border border-edge bg-surface text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none w-28 min-w-0 flex-1 px-2 text-sm"
              />
              <input
                value={draft.email}
                onChange={(event) => set(draft.platform, 'email')(event.target.value)}
                aria-label={`${draft.platform} email`}
                placeholder="email"
                autoComplete="off"
                className="min-h-tap rounded-xl border border-edge bg-surface text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none w-32 min-w-0 flex-1 px-2 text-sm"
              />
              <input
                value={draft.password}
                onChange={(event) => set(draft.platform, 'password')(event.target.value)}
                type="password"
                aria-label={`${draft.platform} password`}
                placeholder="password"
                autoComplete="new-password"
                className="min-h-tap rounded-xl border border-edge bg-surface text-text placeholder:text-state-later/80 transition-colors focus:border-state-now/80 focus:outline-none focus-visible:outline-none w-28 min-w-0 flex-1 px-2 text-sm"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta mt-2 text-state-later">
          None picked yet. You can add them on the brief afterwards.
        </p>
      )}
    </div>
  )
}
