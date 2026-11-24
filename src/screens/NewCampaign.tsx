// A new campaign, typed in on one page.
//
// No brief or contract upload any more: he types the deal in. The name, the
// pay per video, how many videos, whether they have to be high quality (a
// minimum number of views), where they go, and the login for each account -
// asked for right here, under a red warning, because a campaign nobody can
// log into is the one that gets left until it is too late.
//
// How many videos is three choices, and the choice only changes the question:
//
//   Unlimited  - how many a day will you do? (10 to start)
//   1 a day    - nothing more to ask
//   Limited    - how many a day?
//
// All three store the same thing, posts_per_week = videos a day x 7. The data
// layer derives the day's quota from it; nothing here writes that.

import { useId, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AccountsWarning } from '../components/AccountsEditor'
import { KNOWN_PLATFORMS } from '../components/platforms'
import { ChoiceCard } from '../components/roadmap'
import { CARD_CLASS, INPUT_CLASS, buttonClass } from '../components/styles'
import { Button, ScreenHeader, SectionLabel } from '../components/ui'
import { parseCount, parseDollarsToCents, saveFieldValue } from '../data/campaignFields'
import { plainError } from '../data/errorText'
import { useData } from '../data/useData'
import { parseViews } from '../data/views'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'

type Volume = 'unlimited' | 'one' | 'limited'

const VOLUMES: { id: Volume; title: string }[] = [
  { id: 'unlimited', title: 'Unlimited' },
  { id: 'one', title: '1 a day' },
  { id: 'limited', title: 'Limited' },
]

/** Where Unlimited starts: his number, from when he set this screen out. */
const UNLIMITED_PER_DAY = 10

/** One account, as typed. Becomes a campaign_accounts row on Save. */
interface AccountDraft {
  platform: string
  handle: string
  email: string
  password: string
}

export function NewCampaign() {
  const data = useData()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [volume, setVolume] = useState<Volume | null>(null)
  const [perDay, setPerDay] = useState('')
  const [highQuality, setHighQuality] = useState<boolean | null>(null)
  const [minViews, setMinViews] = useState('')
  const [accounts, setAccounts] = useState<AccountDraft[]>([])
  const [ideas, setIdeas] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cents = rate.trim() === '' ? null : parseDollarsToCents(rate)
  const rateInvalid = rate.trim() !== '' && cents === null
  const day = volume === 'one' ? 1 : volume === null ? null : atLeastOne(perDay)
  const views = highQuality === true ? parseViews(minViews) : null

  // What still stands between him and Save, in his words. Pay can be left
  // blank - it reads "not saved yet" until he knows it - but a number that
  // is not one is refused rather than guessed at.
  const missing: string[] = []
  if (name.trim() === '') missing.push('the campaign name')
  if (rateInvalid) missing.push('pay per video as an amount')
  if (volume === null) missing.push('how many videos')
  else if (day === null) missing.push('how many a day')
  if (highQuality === true && views === null) missing.push('the minimum views')

  const chooseVolume = (next: Volume) => {
    setVolume(next)
    // Limited is the deal's own number, so it starts empty for him to type.
    setPerDay(next === 'unlimited' ? String(UNLIMITED_PER_DAY) : '')
  }

  const togglePlatform = (platform: string) => {
    setAccounts((current) =>
      current.some((a) => a.platform === platform)
        ? current.filter((a) => a.platform !== platform)
        : [...current, { platform, handle: '', email: '', password: '' }],
    )
  }

  const setAccount = (platform: string, key: 'handle' | 'email' | 'password', value: string) => {
    setAccounts((current) => current.map((a) => (a.platform === platform ? { ...a, [key]: value } : a)))
  }

  async function save() {
    if (missing.length > 0 || day === null) return
    setBusy(true)
    setError(null)
    try {
      // One transaction: a campaign with half its accounts is a state the app
      // could not tell apart from one that really has only those.
      const campaign = await data.runTransaction(async (tx) => {
        const created = await tx.createCampaign({
          name: name.trim(),
          company: null,
          default_setup: 'face',
          pay_per_video_cents: cents,
          cycle_size: null,
          posts_per_week: day * 7,
          min_views: views,
        })
        let order = 0
        for (const draft of accounts) {
          await tx.addCampaignAccount({
            campaign_id: created.id,
            platform: draft.platform,
            handle: draft.handle.trim() === '' ? null : draft.handle.trim(),
            email: draft.email.trim() === '' ? null : draft.email.trim(),
            password: draft.password === '' ? null : draft.password,
            // Ready from the start: he posts from it the day he adds it.
            status: 'ready',
            sort_order: order++,
          })
        }
        if (ideas.trim() !== '') await saveFieldValue(tx, created.id, GENERATION_BRIEF_KEY, ideas)
        return created
      })
      void navigate(`/campaigns/${campaign.id}`)
    } catch (caught) {
      setError(plainError(caught))
      setBusy(false)
    }
  }

  const accountsAdded = accounts.some((a) => a.handle.trim() !== '')

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-9">
      <ScreenHeader kicker="Campaigns" title="New campaign" />

      <Question label="Campaign name">
        {(id) => (
          <input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            className={`${INPUT_CLASS} w-full text-base`}
          />
        )}
      </Question>

      <Question label="Pay per video" hint="Leave it empty if you don't know it yet.">
        {(id) => (
          <>
            <div className="relative w-44">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-text-dim">
                $
              </span>
              <input
                id={id}
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={rateInvalid}
                className={`${INPUT_CLASS} w-full !pl-8 text-base ${rateInvalid ? '!border-state-blocked' : ''}`}
              />
            </div>
            {rateInvalid ? (
              <p role="alert" className="meta text-state-blocked">
                Enter an amount like 35 or 35.50.
              </p>
            ) : null}
          </>
        )}
      </Question>

      <Question label="How many videos?" group>
        {(id) => (
          <>
            <div role="radiogroup" aria-labelledby={id} className="grid gap-3 sm:grid-cols-3">
              {VOLUMES.map((option, index) => (
                <ChoiceCard
                  key={option.id}
                  index={index}
                  selected={volume === option.id}
                  onSelect={() => chooseVolume(option.id)}
                  title={option.title}
                />
              ))}
            </div>
            {volume === 'unlimited' || volume === 'limited' ? (
              <NumberBox
                label={volume === 'unlimited' ? 'How many a day will you do?' : 'How many a day?'}
                value={perDay}
                onChange={setPerDay}
              />
            ) : null}
          </>
        )}
      </Question>

      <Question
        label="Do you have to make high-quality videos?"
        hint="Is there a minimum number of views?"
        group
      >
        {(id) => (
          <>
            <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-2 gap-3">
              <ChoiceCard selected={highQuality === true} onSelect={() => setHighQuality(true)} title="Yes" />
              <ChoiceCard
                index={1}
                selected={highQuality === false}
                onSelect={() => {
                  setHighQuality(false)
                  setMinViews('')
                }}
                title="No"
              />
            </div>
            {highQuality === true ? (
              <NumberBox label="Minimum views" value={minViews} onChange={setMinViews} />
            ) : null}
          </>
        )}
      </Question>

      <div className="flex flex-col gap-4">
        <SectionLabel>Platforms</SectionLabel>
        <div role="group" aria-label="Platforms" className="flex flex-wrap gap-2">
          {KNOWN_PLATFORMS.map((platform) => {
            const on = accounts.some((a) => a.platform === platform)
            return (
              <button
                key={platform}
                type="button"
                aria-pressed={on}
                onClick={() => togglePlatform(platform)}
                className={[
                  'press min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors duration-200',
                  on ? 'border-brand/70 bg-brand/10 text-text' : 'border-edge text-text-dim hover:border-edge-lit hover:text-text',
                ].join(' ')}
              >
                {platform}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <SectionLabel>Accounts</SectionLabel>
        {accountsAdded ? null : <AccountsWarning />}
        {accounts.length === 0 ? (
          <p className="text-base text-text-dim">Pick a platform above and put its login here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {accounts.map((draft) => (
              <li key={draft.platform} className={`${CARD_CLASS} flex flex-col gap-3 p-4`}>
                <span className="text-lg font-semibold text-text">{draft.platform}</span>
                <div className="grid gap-3 sm:grid-cols-3">
                  <LoginBox
                    name="Username"
                    label={`${draft.platform} handle`}
                    value={draft.handle}
                    onChange={(value) => setAccount(draft.platform, 'handle', value)}
                    placeholder="@handle"
                  />
                  <LoginBox
                    name="Email"
                    label={`${draft.platform} email`}
                    value={draft.email}
                    onChange={(value) => setAccount(draft.platform, 'email', value)}
                  />
                  <LoginBox
                    name="Password"
                    label={`${draft.platform} password`}
                    value={draft.password}
                    onChange={(value) => setAccount(draft.platform, 'password', value)}
                    secret
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Question label="Product & hook ideas" hint="Optional. Hooks get written from this.">
        {(id) => (
          <textarea
            id={id}
            value={ideas}
            onChange={(event) => setIdeas(event.target.value)}
            placeholder="What the product is, and any hooks you already have."
            className={`${INPUT_CLASS} min-h-36 w-full resize-y py-3 text-base leading-relaxed`}
          />
        )}
      </Question>

      <div className="flex flex-col gap-3 border-t border-rule pt-6">
        {error ? <p className="text-base text-state-blocked">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="now" onClick={() => void save()} disabled={busy || missing.length > 0}>
            {busy ? 'Saving...' : 'Save campaign'}
          </Button>
          <Link to="/campaigns" className={buttonClass('ghost')}>
            Cancel
          </Link>
        </div>
        {missing.length > 0 ? <p className="meta text-state-later">Still needed: {missing.join(', ')}.</p> : null}
      </div>
    </section>
  )
}

/** A whole number of videos a day, one or more - or null. */
function atLeastOne(raw: string): number | null {
  const n = parseCount(raw)
  return n === null || n < 1 ? null : n
}

/** One question on the page: a cream label, an optional grey line under it,
 *  then the answer. `group` labels a set of choices rather than one box. */
function Question({
  label,
  hint,
  group = false,
  children,
}: {
  label: string
  hint?: string
  group?: boolean
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {group ? (
          <p id={id} className="text-base font-semibold text-text">
            {label}
          </p>
        ) : (
          <label htmlFor={id} className="text-base font-semibold text-text">
            {label}
          </label>
        )}
        {hint ? <p className="meta text-state-later">{hint}</p> : null}
      </div>
      {children(id)}
    </div>
  )
}

function NumberBox({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const id = useId()
  return (
    <div className="settle-in flex flex-col gap-2">
      <label htmlFor={id} className="text-base text-text-dim">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        className={`${INPUT_CLASS} w-36 text-base`}
      />
    </div>
  )
}

function LoginBox({
  name,
  label,
  value,
  onChange,
  placeholder,
  secret = false,
}: {
  name: string
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  secret?: boolean
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="label text-state-later">{name}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        type={secret ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${INPUT_CLASS} w-full min-w-0 text-base`}
      />
    </label>
  )
}
