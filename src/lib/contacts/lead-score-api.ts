export interface LeadScoreHistoryEntry {
  id: string;
  old_score: 'hot' | 'warm' | 'cold' | null;
  new_score: 'hot' | 'warm' | 'cold';
  reason: string | null;
  source: 'ai' | 'manual';
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export async function fetchLeadScoreHistory(
  contactId: string,
): Promise<LeadScoreHistoryEntry[]> {
  const response = await fetch(`/api/contacts/${contactId}/lead-score`);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    history?: LeadScoreHistoryEntry[];
  };
  if (!response.ok) {
    throw new Error(body.error ?? 'Failed to load lead score history');
  }
  return body.history ?? [];
}

export async function setLeadScore(
  contactId: string,
  score: 'hot' | 'warm' | 'cold',
  reason?: string,
): Promise<void> {
  const response = await fetch(`/api/contacts/${contactId}/lead-score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score, reason }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? 'Failed to update lead score');
  }
}
