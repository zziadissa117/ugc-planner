// Re-briefing a campaign that already exists.
//
// He re-briefs every couple of weeks - a rate changes, a platform is added, a
// new document lists hooks he can use. Dropping that document through
// NewCampaign would create a second campaign, because applyParseResult always
// calls createCampaign. This screen parses the same way and merges instead.
//
// The rule this screen exists to hold: a field he already confirmed never
// changes without his tap. New material - a field the campaign never had, a
// rule, a bonus tier - carries no such risk and is applied straight away.
// Only a conflict - a confirmed value the new document disagrees with - stops
// and asks, one field at a time, defaulting to "keep what I have."

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { DocumentInput, type Upload } from '../components/DocumentInput'
import { fieldLabel } from '../components/fieldLabel'
import { ReadingProgress } from '../components/ReadingProgress'
import type { Campaign } from '../data'
import { useData } from '../data/useData'
import {
  PastedJsonParser,
  applyCampaignUpdate,
  diffFields,
  inspectBrief,
  newBonusTiers,
  newRules,
  verifyQuotes,
  type FieldDiff,
  type ParseResult,
} from '../parser'
import { EdgeFunctionParser } from '../parser/edgeFunction'
import type { ParsedBonusTier } from '../parser/types'

export function UpdateCampaign() {
  const { campaignId } = useParams()
  const data = useData()
  const navigate = useNavigate()

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [missing, setMissing] = useState(false)

  const [brief, setBrief] = useState<Upload>({ text: '', filename: null })
  const [contract, setContract] = useState<Upload>({ text: '', filename: null })
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)

  const [result, setResult] = useState<ParseResult | null>(null)
  const [fieldDiffs, setFieldDiffs] = useState<FieldDiff[]>([])
  const [addedRules, setAddedRules] = useState<string[]>([])
  const [addedTiers, setAddedTiers] = useState<ParsedBonusTier[]>([])
  // Which conflicts he has chosen "Use new" for. Everything not in this set
  // keeps its current value - that is the default, not an opt-in.
  const [useNew, setUseNew] = useState<Set<string>>(new Set())

  const briefText = brief.text.trim() === '' ? null : brief.text
  const contractText = contract.text.trim() === '' ? null : contract.text

  const edgeParser = new EdgeFunctionParser()
  const serverAvailable = edgeParser.isAvailable()
  const useServer = serverAvailable && json.trim() === ''

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    void data.getCampaign(campaignId).then((row) => {
      if (cancelled) return
      if (row) setCampaign(row)
      else setMissing(true)
    })
    return () => {
      cancelled = true
    }
  }, [campaignId, data])

  const runParse = useCallback(async () => {
    if (!campaignId || !campaign) return
    setError(null)
    setParsing(true)
    try {
      const parsed = useServer
        ? await edgeParser.parse({ briefText, contractText })
        : await new PastedJsonParser().parse({ briefText, contractText, json })

      const integrity = briefText === null ? null : inspectBrief(briefText)
      const verified = verifyQuotes(
        {
          ...parsed,
          brief_is_incomplete: (integrity?.isIncomplete ?? false) || parsed.brief_is_incomplete,
          warnings: [...parsed.warnings, ...(integrity?.reasons ?? [])],
        },
        { briefText, contractText },
      )

      const [currentFields, currentRules, currentTiers] = await Promise.all([
        data.listCampaignFields(campaignId),
        data.listCampaignRules(campaignId),
        data.listBonusTiers(campaignId),
      ])

      setResult(verified.result)
      setFieldDiffs(diffFields(currentFields, campaign, verified.result))
      setAddedRules(newRules(currentRules, verified.result))
      setAddedTiers(newBonusTiers(currentTiers, verified.result))
      setUseNew(new Set())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setParsing(false)
    }
  }, [briefText, campaignId, contractText, data, edgeParser, json, useServer])

  const apply = useCallback(async () => {
    if (!campaignId || !result) return
    setBusy(true)
    try {
      const newFieldKeys = new Set(
        fieldDiffs.filter((d) => d.status === 'new').map((d) => d.key),
      )
      await applyCampaignUpdate(data, {
        campaignId,
        result,
        acceptedNewFieldKeys: newFieldKeys,
        acceptedConflictFieldKeys: useNew,
        briefText,
        briefFilename: brief.filename,
        contractText,
        contractFilename: contract.filename,
      })
      void navigate(`/campaigns/${campaignId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [brief.filename, briefText, campaignId, contract.filename, contractText, data, fieldDiffs, navigate, result, useNew])

  if (missing) return <p className="text-state-later">No such campaign.</p>
  if (!campaign) return null

  if (result) {
    const conflicts = fieldDiffs.filter((d) => d.status === 'conflict')
    const newFields = fieldDiffs.filter((d) => d.status === 'new')
    const unchanged = fieldDiffs.filter((d) => d.status === 'same')

    return (
      <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold text-text">Update {campaign.name}</h1>
          <p className="text-state-later">
            Nothing changes until you tap Apply. Nothing already confirmed changes without you
            choosing it below.
          </p>
        </header>

        {result.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {result.warnings.map((warning) => (
              <li key={warning} className="text-sm text-state-waiting">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        {conflicts.length > 0 ? (
          <div>
            <h2 className="text-lg font-semibold text-state-blocked">
              Disagrees with what you already confirmed - {conflicts.length}
            </h2>
            <p className="mt-1 text-sm text-state-later">
              Nothing here changes unless you tap "Use new". The default is to keep what you have.
            </p>
            <div className="mt-2 flex flex-col gap-3">
              {conflicts.map((diff) => (
                <ConflictRow
                  key={diff.key}
                  diff={diff}
                  chosen={useNew.has(diff.key)}
                  onChoose={(choose) =>
                    setUseNew((current) => {
                      const next = new Set(current)
                      if (choose) next.add(diff.key)
                      else next.delete(diff.key)
                      return next
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {newFields.length > 0 ? (
          <div>
            <h2 className="text-lg font-semibold text-text">New in this document - {newFields.length}</h2>
            <p className="mt-1 text-sm text-state-later">
              Nothing here existed before, so all of it will be added - amber until you confirm it,
              same as a fresh parse.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {newFields.map((diff) => (
                <li key={diff.key} className="rounded-lg border border-edge bg-surface p-3">
                  <p className="text-sm text-state-later">{fieldLabel(diff.key)}</p>
                  <p className="text-text">{diff.parsedValue}</p>
                  {diff.parsedQuote ? (
                    <p className="mt-1 text-xs text-state-later">"{diff.parsedQuote}"</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {addedRules.length > 0 ? (
          <div>
            <h2 className="text-lg font-semibold text-text">New rules - {addedRules.length}</h2>
            <p className="mt-1 text-sm text-state-later">
              Added to what you already have. A rule missing from this document is not proof the
              old ones stopped applying, so nothing is ever removed here.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {addedRules.map((body) => (
                <li key={body} className="border-l-2 border-state-blocked/50 pl-3 text-sm text-text">
                  {body}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {addedTiers.length > 0 ? (
          <div>
            <h2 className="text-lg font-semibold text-text">New bonus tiers - {addedTiers.length}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {addedTiers.map((tier) => (
                <li key={tier.threshold_views} className="text-sm text-text">
                  {tier.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {conflicts.length === 0 && newFields.length === 0 && addedRules.length === 0 && addedTiers.length === 0 ? (
          <p className="text-state-later">
            Nothing new. The document matches what is already saved
            {unchanged.length > 0 ? ` (checked ${unchanged.length} field${unchanged.length === 1 ? '' : 's'})` : ''}.
          </p>
        ) : null}

        {error ? <p className="text-state-blocked">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy}
            className="min-h-tap flex-1 rounded-lg border border-state-now bg-surface-raised px-4 font-semibold text-state-now active:bg-surface disabled:opacity-60"
          >
            Apply update
          </button>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
          >
            Back
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">Update {campaign.name}</h1>
        <p className="text-state-later">
          Drop the new brief or contract. What has not changed is left alone; what has is flagged,
          never overwritten without a tap.
        </p>
      </header>

      <DocumentInput label="NEW BRIEF (.md)" upload={brief} onChange={setBrief} />
      <DocumentInput label="NEW CONTRACT (.md)" upload={contract} onChange={setContract} />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          Parsed JSON
        </h2>
        <p className="mt-1 text-sm text-state-later">
          {serverAvailable
            ? "Tap Compare and the server reads the documents above for you."
            : 'The server parser is not deployed, so run the documents through a model yourself and paste what it gives back.'}
        </p>
        <textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          aria-label="Parsed JSON"
          spellCheck={false}
          className="mt-3 h-40 w-full resize-y rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later"
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
        {parsing ? 'Reading the documents...' : 'Compare with what is saved'}
      </button>
    </section>
  )
}

function ConflictRow({
  diff,
  chosen,
  onChoose,
}: {
  diff: FieldDiff
  chosen: boolean
  onChoose: (choose: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-state-blocked/50 bg-surface p-3">
      <p className="text-sm font-semibold text-text">{fieldLabel(diff.key)}</p>

      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-state-later">
        You have
      </p>
      <p className="text-text">{diff.currentValue}</p>

      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-state-waiting">
        New document says
      </p>
      <p className="text-text">{diff.parsedValue}</p>
      {diff.parsedQuote ? (
        <p className="mt-1 text-xs text-state-later">"{diff.parsedQuote}"</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onChoose(false)}
          aria-pressed={!chosen}
          className={[
            'min-h-tap flex-1 rounded-lg border px-3 text-sm font-semibold active:bg-surface-raised',
            !chosen
              ? 'border-state-now bg-surface-raised text-state-now'
              : 'border-edge text-state-later',
          ].join(' ')}
        >
          Keep old
        </button>
        <button
          type="button"
          onClick={() => onChoose(true)}
          aria-pressed={chosen}
          className={[
            'min-h-tap flex-1 rounded-lg border px-3 text-sm font-semibold active:bg-surface-raised',
            chosen
              ? 'border-state-now bg-surface-raised text-state-now'
              : 'border-edge text-state-later',
          ].join(' ')}
        >
          Use new
        </button>
      </div>
    </div>
  )
}
