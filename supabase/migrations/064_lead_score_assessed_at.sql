-- ============================================================
-- 064_lead_score_assessed_at.sql — "was this lead actually
-- assessed today", independent of "did the score change"
--
-- lead_score_updated_at (migration 061) is trigger-maintained and
-- ONLY moves when contacts.lead_score's VALUE changes — a contact the
-- AI re-confirms as HOT for the third day running never touches it.
-- That's correct for its existing job (the "stale, hasn't been
-- reassessed in a while" badge, and the change-audit trail in
-- lead_score_history), but it makes it impossible to answer "how many
-- leads did the AI actually qualify today" for a dashboard summary —
-- reconfirmed-unchanged leads would silently be missed, undercounting
-- exactly the leads (steady HOTs) that matter most to show off.
--
-- contacts.lead_score_assessed_at is the deliberately separate,
-- unconditional counterpart: applyLeadScore() (src/lib/ai/
-- lead-scoring.ts) stamps it on every AI scoring pass, value-changed
-- or not. Manual overrides also stamp it (a human review is still an
-- assessment). Nothing else reads or maintains this column — the
-- staleness badge and history trail keep using lead_score_updated_at
-- exactly as before.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score_assessed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_score_assessed_at
  ON contacts (account_id, lead_score, lead_score_assessed_at);
