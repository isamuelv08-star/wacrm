-- ============================================================
-- 079_booking_pages.sql — services, staff availability, and public
-- booking pages (Calendly-style self-service appointment links) for
-- clinics/spas/appointment-based businesses.
--
-- Builds on calendar_events (057) rather than a parallel appointments
-- table: an appointment IS a calendar_events row (type='appointment'),
-- with `assigned_to` already meaning "who owns this" reused here as
-- "which staff member is booked" — no new specialist column needed.
--
-- New tables
--   services                      — bookable offerings (name, duration, price)
--   service_staff                 — which staff can perform which service
--   staff_availability            — weekly working-hours rules per staff member
--   staff_availability_exceptions — one-off blocked days/hours (time off,
--                                   holidays) that override the weekly rule
--   booking_pages                 — one shareable public link ("like Calendly"),
--                                   scoped to a set of services
--   booking_page_services         — join: which services a page offers
--   booking_page_staff            — join: which staff appear on a page
--                                   (empty = derive from service_staff)
--
-- Public-write posture: the booking flow itself (list open slots, file
-- a booking) is unauthenticated by definition — a stranger with the
-- link has no account membership. Those endpoints therefore run
-- server-side with the service-role client
-- (src/lib/booking/admin-client.ts, same posture as every other
-- admin-client.ts in this codebase) after their own validation (page
-- must be active, slot must still be free), rather than through RLS.
-- RLS below only governs the *dashboard* (account members configuring
-- services/hours/pages), same three-tier shape as 017_account_sharing:
-- viewer reads, agent+ operates, admin+ configures.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price NUMERIC(12,2),
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_account ON services(account_id);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS services_select ON services;
CREATE POLICY services_select ON services FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS services_insert ON services;
CREATE POLICY services_insert ON services FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS services_update ON services;
CREATE POLICY services_update ON services FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS services_delete ON services;
CREATE POLICY services_delete ON services FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON services;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- service_staff — which staff (profiles) can perform which service.
-- No rows for a service = "any agent+ member can perform it" (the
-- slot engine's fallback, see src/lib/booking/availability.ts) so a
-- single-person business never has to fill this in.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_staff (
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, profile_id)
);

ALTER TABLE service_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_staff_select ON service_staff;
CREATE POLICY service_staff_select ON service_staff FOR SELECT USING (
  EXISTS (SELECT 1 FROM services s WHERE s.id = service_staff.service_id AND is_account_member(s.account_id))
);
DROP POLICY IF EXISTS service_staff_modify ON service_staff;
CREATE POLICY service_staff_modify ON service_staff FOR ALL USING (
  EXISTS (SELECT 1 FROM services s WHERE s.id = service_staff.service_id AND is_account_member(s.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM services s WHERE s.id = service_staff.service_id AND is_account_member(s.account_id, 'admin'))
);

-- ------------------------------------------------------------
-- staff_availability — weekly working-hours rules. `weekday` is
-- 0=Sunday..6=Saturday (JS Date#getDay() convention — matches how the
-- rest of this codebase, e.g. src/lib/automations/schedule.ts, already
-- reasons about days of week). Times are wall-clock in the ACCOUNT's
-- timezone (accounts.timezone, migration 065), not UTC — resolved at
-- slot-computation time, same posture as localDateTimeToUtcIso.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_availability_profile
  ON staff_availability(profile_id, weekday);

ALTER TABLE staff_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_availability_select ON staff_availability;
CREATE POLICY staff_availability_select ON staff_availability FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS staff_availability_modify ON staff_availability;
CREATE POLICY staff_availability_modify ON staff_availability FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- staff_availability_exceptions — one-off overrides: a day off
-- (is_available=false, times NULL) or reduced/extra hours on a
-- specific date (is_available=true with its own start/end).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, date)
);

ALTER TABLE staff_availability_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_availability_exceptions_select ON staff_availability_exceptions;
CREATE POLICY staff_availability_exceptions_select ON staff_availability_exceptions FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS staff_availability_exceptions_modify ON staff_availability_exceptions;
CREATE POLICY staff_availability_exceptions_modify ON staff_availability_exceptions FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- booking_pages — one shareable public link. `slug` is globally
-- unique (it's the whole path segment in /agendar/<slug>, with no
-- account identifier alongside it — same "short public link" shape as
-- account_invitations, but slugs are human-chosen/readable rather than
-- a random token since they're meant to be typed/shared, not just
-- clicked).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- NULL = fall back to accounts.timezone at slot-computation time.
  timezone TEXT,
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  min_notice_hours INTEGER NOT NULL DEFAULT 2 CHECK (min_notice_hours >= 0),
  booking_window_days INTEGER NOT NULL DEFAULT 30 CHECK (booking_window_days > 0),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_pages_account ON booking_pages(account_id);

ALTER TABLE booking_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_pages_select ON booking_pages;
CREATE POLICY booking_pages_select ON booking_pages FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS booking_pages_insert ON booking_pages;
CREATE POLICY booking_pages_insert ON booking_pages FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS booking_pages_update ON booking_pages;
CREATE POLICY booking_pages_update ON booking_pages FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS booking_pages_delete ON booking_pages;
CREATE POLICY booking_pages_delete ON booking_pages FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON booking_pages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS booking_page_services (
  booking_page_id UUID NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (booking_page_id, service_id)
);

ALTER TABLE booking_page_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_page_services_select ON booking_page_services;
CREATE POLICY booking_page_services_select ON booking_page_services FOR SELECT USING (
  EXISTS (SELECT 1 FROM booking_pages p WHERE p.id = booking_page_services.booking_page_id AND is_account_member(p.account_id))
);
DROP POLICY IF EXISTS booking_page_services_modify ON booking_page_services;
CREATE POLICY booking_page_services_modify ON booking_page_services FOR ALL USING (
  EXISTS (SELECT 1 FROM booking_pages p WHERE p.id = booking_page_services.booking_page_id AND is_account_member(p.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM booking_pages p WHERE p.id = booking_page_services.booking_page_id AND is_account_member(p.account_id, 'admin'))
);

CREATE TABLE IF NOT EXISTS booking_page_staff (
  booking_page_id UUID NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (booking_page_id, profile_id)
);

ALTER TABLE booking_page_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_page_staff_select ON booking_page_staff;
CREATE POLICY booking_page_staff_select ON booking_page_staff FOR SELECT USING (
  EXISTS (SELECT 1 FROM booking_pages p WHERE p.id = booking_page_staff.booking_page_id AND is_account_member(p.account_id))
);
DROP POLICY IF EXISTS booking_page_staff_modify ON booking_page_staff;
CREATE POLICY booking_page_staff_modify ON booking_page_staff FOR ALL USING (
  EXISTS (SELECT 1 FROM booking_pages p WHERE p.id = booking_page_staff.booking_page_id AND is_account_member(p.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM booking_pages p WHERE p.id = booking_page_staff.booking_page_id AND is_account_member(p.account_id, 'admin'))
);

-- ------------------------------------------------------------
-- calendar_events — extend for appointments booked through a service
-- + booking page, and to know where a booking came from.
-- ------------------------------------------------------------
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_page_id UUID REFERENCES booking_pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_bot', 'public_link')),
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;

-- Widen `type` to add 'appointment' — carries forward 'call',
-- 'meeting', 'follow_up', 'task', 'other' from migration 057;
-- dropping/recreating this constraint with a short list would
-- silently break the other event types.
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_type_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_type_check
  CHECK (type IN ('call', 'meeting', 'follow_up', 'task', 'appointment', 'other'));

-- Overlap-prevention hot path: "does this staff member already have a
-- pending appointment in this window" is the query the slot engine
-- and the booking-race check both run.
CREATE INDEX IF NOT EXISTS idx_calendar_events_assigned_range
  ON calendar_events(assigned_to, starts_at, ends_at)
  WHERE status = 'pending';

-- Widen the notification type check (same idiom as migration 057) so
-- a public booking can raise a staff-facing notification distinct
-- from the existing 'event_reminder'. Carries forward every type
-- accumulated since 027 — dropping and recreating this constraint
-- with a short list would silently break every other notification
-- type.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'hot_lead_unanswered', 'lead_qualified',
    'new_lead', 'lead_scored', 'new_message', 'lead_stale', 'event_reminder',
    'appointment_booked'
  ));

-- ------------------------------------------------------------
-- Which APPROVED WhatsApp template to use for the two customer-facing
-- appointment messages (src/lib/booking/notify.ts). Nullable: until an
-- admin picks one (Settings) — because Meta must first approve it,
-- which can take 24-48h and cannot happen automatically — booking
-- keeps working, it just skips the WhatsApp send for that leg. No
-- ON DELETE CASCADE: losing the account's template selection isn't
-- worth taking calendar_events down with it, so a deleted template
-- just unsets the pointer.
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS appointment_confirmation_template_id UUID
    REFERENCES message_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_reminder_template_id UUID
    REFERENCES message_templates(id) ON DELETE SET NULL;
