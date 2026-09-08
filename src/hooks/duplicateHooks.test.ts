// Refusing to save back a hook he already has.
//
// The failure this exists for, in the generator's own words: "All three
// MATERIAL lines were used near-verbatim as hooks 1-3 per instructions to
// build from them." Six hooks came back and every one was a light reword of a
// line already in his hook bank - he paid for a batch and got his own writing
// returned. The prompt forbids it; this makes it impossible.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { alreadyHave, hookFingerprint, saveGeneratedHooks } from './generateHooks'

describe('recognising a hook he already has', () => {
  const bank = [
    'opened my laptop in class and forgot this was still on screen',
    "my roommate's chat history and I have questions",
    'This took me nine seconds to break.',
    'You do not have to like AI to need to know this part.',
  ]

  it('catches the exact rewordings it actually returned', () => {
    // Verbatim from the batch he was given.
    for (const returned of [
      'I opened my laptop and forgot my whole chat history was still on screen.',
      "My roommate's chat history is open right now and I have questions.",
      "This took me nine seconds to break, and it never once said it wasn't sure.",
      "You don't have to like AI to need to know this part of it.",
    ]) {
      expect(alreadyHave(returned, bank)).toBe(true)
    }
  })

  it('lets a genuinely different hook through', () => {
    for (const fresh of [
      'It cited a paper that does not exist and gave me the page number.',
      'I asked it how many people live in my town. It was off by ninety thousand.',
      'The chat title I forgot about is the one my sister screenshotted.',
    ]) {
      expect(alreadyHave(fresh, bank)).toBe(false)
    }
  })

  it('ignores case, punctuation and the small words', () => {
    expect(hookFingerprint('This took me NINE seconds to break!')).toBe(
      hookFingerprint('this took me nine seconds to break'),
    )
  })

  it('treats an empty hook as one to drop', () => {
    expect(alreadyHave('   ', bank)).toBe(true)
  })
})

describe('saving a generated batch', () => {
  const USER = '11111111-1111-4111-8111-111111111111'
  let adapter: LocalAdapter
  let campaignId: string

  beforeEach(async () => {
    indexedDB = new IDBFactory()
    const db = new LocalDatabase(`dupe-${crypto.randomUUID()}`)
    adapter = new LocalAdapter(db, USER)
    await db.open()

    const campaign = await adapter.createCampaign({
      name: 'Vertus',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 4000,
      cycle_size: null,
    })
    campaignId = campaign.id

    await adapter.addCampaignHook({
      campaign_id: campaignId,
      angle_id: null,
      body: 'This took me nine seconds to break.',
      outline: null,
      source: 'user_entered',
      model: null,
      generated_at: null,
      used_at: null,
    })
  })

  it('keeps the new one and drops the reworded one', async () => {
    const saved = await saveGeneratedHooks(
      adapter,
      campaignId,
      {
        hooks: [
          {
            body: "This took me nine seconds to break, and it never once said it wasn't sure.",
            outline: null,
            angle_id: null,
          },
          {
            body: 'It cited a paper that does not exist and gave me the page number.',
            outline: null,
            angle_id: null,
          },
        ],
        warnings: [],
      },
      'claude-sonnet-5',
    )

    expect(saved).toBe(1)
    const hooks = await adapter.listCampaignHooks(campaignId)
    expect(hooks).toHaveLength(2)
    expect(hooks.filter((hook) => hook.source === 'generated')).toHaveLength(1)
  })

  it('does not save the same new hook twice within one batch', async () => {
    const twice = {
      body: 'It cited a paper that does not exist and gave me the page number.',
      outline: null,
      angle_id: null,
    }
    const saved = await saveGeneratedHooks(
      adapter,
      campaignId,
      { hooks: [twice, { ...twice, body: twice.body.toUpperCase() }], warnings: [] },
      'claude-sonnet-5',
    )
    expect(saved).toBe(1)
  })
})
