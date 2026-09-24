-- ============================================================
-- 109_stage_changed_activity.sql — widen ai_activity_events for
-- human-triggered stage changes, not just AI ones
--
-- migration 075's own doc comment already designed this table to take
-- new event types without changing its shape (JSONB payload) — only
-- the CHECK constraint's allow-list needs widening. 'stage_changed'
-- covers a rep manually moving a deal's stage from the inbox sidebar
-- (contact-sidebar.tsx's inline stage picker) so the change is
-- visible inline in the thread the same way "Saleslid qualified this
-- lead" already is — "Ventas 1 movió este lead a Calificado" — instead
-- of only being discoverable on the pipeline board.
--
-- Written the same way every other event here is: server-side only,
-- via the service-role client (see src/app/api/deals/[id]/stage/route.ts)
-- — no INSERT policy for `authenticated`, matching 075's own posture.
-- ============================================================

ALTER TABLE ai_activity_events DROP CONSTRAINT IF EXISTS ai_activity_events_event_type_check;
ALTER TABLE ai_activity_events ADD CONSTRAINT ai_activity_events_event_type_check
  CHECK (event_type IN ('lead_scored', 'lead_qualified', 'stage_changed'));
