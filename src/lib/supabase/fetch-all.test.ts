import { describe, it, expect } from 'vitest'
import { fetchAllRows } from './fetch-all'

function source(total: number) {
  const all = Array.from({ length: total }, (_, i) => i)
  const calls: [number, number][] = []
  const build = (from: number, to: number) => {
    calls.push([from, to])
    return Promise.resolve({ data: all.slice(from, to + 1), error: null })
  }
  return { build, calls }
}

describe('fetchAllRows', () => {
  it('reads past the 1000-row page boundary', async () => {
    const { build, calls } = source(2500)
    const rows = await fetchAllRows(build)
    expect(rows).toHaveLength(2500)
    expect(rows[2499]).toBe(2499)
    expect(calls).toHaveLength(3)
  })

  it('stops after a single short page', async () => {
    const { build, calls } = source(10)
    expect(await fetchAllRows(build)).toHaveLength(10)
    expect(calls).toHaveLength(1)
  })

  it('respects maxRows', async () => {
    const { build } = source(5000)
    expect(await fetchAllRows(build, { pageSize: 1000, maxRows: 2000 })).toHaveLength(2000)
  })

  it('throws query errors', async () => {
    await expect(
      fetchAllRows(() => Promise.resolve({ data: null, error: new Error('boom') })),
    ).rejects.toThrow('boom')
  })
})
