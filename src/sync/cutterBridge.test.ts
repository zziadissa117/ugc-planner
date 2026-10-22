import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
let session: object | null = null

vi.mock('./auth', () => ({
  getSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    functions: { invoke },
  }),
}))

const { fetchCutterScheduled, listCutterCampaigns } = await import('./cutterBridge')

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { enabled: true, campaigns: [{ id: 'c1', name: 'Pump' }], posts: [] }, error: null })
})

describe('the cutter bridge', () => {
  it('asks nothing while signed out - the function only answers a signed-in user', async () => {
    session = null
    expect(await listCutterCampaigns()).toBeNull()
    expect(await fetchCutterScheduled()).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('asks once signed in, as before', async () => {
    session = { user: { id: 'u1' } }
    expect(await listCutterCampaigns()).toEqual([{ id: 'c1', name: 'Pump' }])
    expect(invoke).toHaveBeenCalledWith('cutter-posted', { body: { action: 'campaigns' } })
  })
})
