import type { TeamMember } from '@/lib/dashboard/member-detail'

/**
 * No rich-text editor, no embedded mention tokens — @-mentions are
 * plain "@Full Name" substrings the composer inserts when you pick
 * someone from the autocomplete (team-chat-composer.tsx). At send
 * time, scan the final text against every real account member's name
 * to resolve which ones were actually mentioned; that list becomes
 * `mentioned_user_ids`, which the DB trigger (090_team_chat.sql,
 * notify_team_chat_mentions) turns into notifications.
 *
 * Good enough for the team sizes this app manages (a handful of
 * people per account) — the one sharp edge is two members with the
 * exact same full name, which resolves as a mention of both. Sorted
 * longest-name-first so "Juan Pérez" doesn't get shadowed by a
 * shorter "Juan" also being a member.
 */
export function extractMentionedUserIds(body: string, roster: TeamMember[]): string[] {
  const found = new Set<string>()
  const candidates = [...roster]
    .filter((m) => m.name.trim().length >= 2)
    .sort((a, b) => b.name.length - a.name.length)
  for (const member of candidates) {
    if (body.includes(`@${member.name}`)) found.add(member.userId)
  }
  return [...found]
}

export interface BodySegment {
  text: string
  mention: TeamMember | null
}

/**
 * Splits a message body into plain-text and @-mention segments for
 * rendering — the mirror of extractMentionedUserIds, used by
 * team-chat-message.tsx to highlight the same spans it detected at
 * send time. Only highlights members actually present in
 * `mentionedUserIds` (not just anyone whose name happens to appear in
 * the text), so a name mentioned in passing without the @ prefix
 * intent never lights up.
 */
export function splitBodyByMentions(
  body: string,
  mentionedUserIds: string[],
  roster: TeamMember[],
): BodySegment[] {
  if (mentionedUserIds.length === 0) return [{ text: body, mention: null }]

  const mentioned = roster
    .filter((m) => mentionedUserIds.includes(m.userId) && m.name.trim().length >= 2)
    .sort((a, b) => b.name.length - a.name.length)
  if (mentioned.length === 0) return [{ text: body, mention: null }]

  const pattern = mentioned.map((m) => `@${escapeRegExp(m.name)}`).join('|')
  const re = new RegExp(`(${pattern})`, 'g')
  const byToken = new Map(mentioned.map((m) => [`@${m.name}`, m]))

  return body
    .split(re)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, mention: byToken.get(part) ?? null }))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
