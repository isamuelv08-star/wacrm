import { describe, it, expect, vi } from 'vitest'
import { pickRoundRobinAgent } from './round-robin'

function dbWithRpc(result: { data?: unknown; error?: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('pickRoundRobinAgent', () => {
  it('calls next_round_robin_agent with the account id and returns the resolved agent', async () => {
    const db = dbWithRpc({ data: 'agent-1', error: null })
    const result = await pickRoundRobinAgent(db, 'acct-1')
    expect(db.rpc).toHaveBeenCalledWith('next_round_robin_agent', {
      p_account_id: 'acct-1',
    })
    expect(result).toBe('agent-1')
  })

  it('returns null when the account has no eligible agents', async () => {
    const db = dbWithRpc({ data: null, error: null })
    const result = await pickRoundRobinAgent(db, 'acct-1')
    expect(result).toBeNull()
  })

  it('returns null and logs when the RPC errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = dbWithRpc({ data: undefined, error: { message: 'boom' } })
    const result = await pickRoundRobinAgent(db, 'acct-1')
    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
