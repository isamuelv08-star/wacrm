-- ============================================================
-- 096_conversation_ad_referral.sql — capture the actual ad a
-- Click-to-WhatsApp conversation started from, not just a generic
-- "Meta Ads" tag.
--
-- Meta's referral object (forwarded verbatim by both the direct-Meta
-- webhook and, as of this migration, the Zernio bridge) already
-- carries the ad's headline, image, source URL and click id
-- (src/lib/contacts/lead-source.ts's `MetaReferral`) — until now only
-- `source_type` was used, to set a generic "Meta Ads" custom-field
-- value; every other field was discarded. Stored once, on the
-- conversation the click actually opened, and never overwritten
-- (Meta only sends it on the first inbound message after the click).
--
-- Idempotente — segura de re-ejecutar.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ad_referral JSONB;
