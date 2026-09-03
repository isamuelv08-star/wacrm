-- ============================================================
-- 070_business_vertical.sql — what kind of business this account is
--
-- Chosen in the first onboarding step (before WhatsApp) and used to
-- decide whether the wizard suggests connecting Google Calendar: a
-- clinic or travel agency lives and dies by appointments, a retail/
-- sales account mostly doesn't. Purely a UX hint — nothing in the
-- backend gates a feature on this column, so an account can always
-- connect Google Calendar from Settings regardless of its vertical.
--
-- NULL means "not chosen yet" (every existing account as of this
-- migration). Set once from onboarding, editable later would be a
-- Settings feature, not needed for v1.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_vertical TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_business_vertical_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_business_vertical_check
      CHECK (business_vertical IS NULL OR business_vertical IN (
        'sales_retail',
        'medical_clinic',
        'spa_beauty',
        'travel_agency',
        'real_estate',
        'workshop_service',
        'professional_services',
        'other'
      ));
  END IF;
END $$;
