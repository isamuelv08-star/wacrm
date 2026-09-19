import { describe, expect, it } from 'vitest'
import type { TeamMember } from '@/lib/dashboard/member-detail'
import { extractMentionedUserIds, splitBodyByMentions } from './mentions'

const member = (userId: string, name: string): TeamMember => ({
  userId,
  profileId: `p-${userId}`,
  name,
  avatarUrl: null,
})

const roster = [member('u1', 'Pedro Pérez'), member('u2', 'Pedro'), member('u3', 'Ana Ruiz')]

describe('extractMentionedUserIds', () => {
  it('resolves @Full Name mentions to user ids', () => {
    expect(extractMentionedUserIds('@Ana Ruiz revisa este precio', roster)).toEqual(['u3'])
  })

  it('returns nothing when there is no @ prefix', () => {
    expect(extractMentionedUserIds('Ana Ruiz revisa este precio', roster)).toEqual([])
  })

  it('finds several distinct mentions', () => {
    const ids = extractMentionedUserIds('@Ana Ruiz y @Pedro Pérez, miren esto', roster)
    expect(ids.sort()).toEqual(['u1', 'u3'])
  })

  it('does not notify a shorter name contained in a longer one already mentioned', () => {
    // Members "Pedro" and "Pedro Pérez": "@Pedro Pérez" is only the latter.
    expect(extractMentionedUserIds('@Pedro Pérez revisa esto', roster)).toEqual(['u1'])
  })

  it('still matches the shorter name when it is also mentioned on its own', () => {
    const ids = extractMentionedUserIds('@Pedro Pérez y también @Pedro', roster)
    expect(ids.sort()).toEqual(['u1', 'u2'])
  })

  it('does not duplicate a member mentioned twice', () => {
    expect(extractMentionedUserIds('@Ana Ruiz @Ana Ruiz', roster)).toEqual(['u3'])
  })

  it('ignores members with a blank name', () => {
    expect(extractMentionedUserIds('@ hola', [member('u9', ' ')])).toEqual([])
  })
})

describe('splitBodyByMentions', () => {
  it('returns one plain segment when nobody was mentioned', () => {
    expect(splitBodyByMentions('hola', [], roster)).toEqual([{ text: 'hola', mention: null }])
  })

  it('highlights only members present in mentionedUserIds', () => {
    const segs = splitBodyByMentions('@Ana Ruiz mira, y Pedro también', ['u3'], roster)
    expect(segs.filter((s) => s.mention).map((s) => s.mention!.userId)).toEqual(['u3'])
    expect(segs.map((s) => s.text).join('')).toBe('@Ana Ruiz mira, y Pedro también')
  })

  it('prefers the longest matching name so "Pedro" does not shadow "Pedro Pérez"', () => {
    const segs = splitBodyByMentions('@Pedro Pérez ok', ['u1', 'u2'], roster)
    expect(segs.find((s) => s.mention)?.mention?.userId).toBe('u1')
  })

  it('escapes regex characters in names', () => {
    const r = [member('u5', 'A.B (Ventas)')]
    const segs = splitBodyByMentions('hola @A.B (Ventas)!', ['u5'], r)
    expect(segs.find((s) => s.mention)?.text).toBe('@A.B (Ventas)')
  })
})
