-- ============================================================
-- 059_realtime_deals_contacts.sql — make sure `deals`, `contacts`, and
-- `sales_goals` are in the supabase_realtime publication.
--
-- The dashboard's sales-section subscription (postgres_changes on
-- `deals` and `sales_goals`) and the pipelines page's own new
-- subscription all rely on this, and there was no migration anywhere
-- that added any of these three to the publication — only `messages`,
-- `conversations`, `message_reactions`, `flow_runs`,
-- `member_presence`, `notifications`, and (as of migration 057)
-- `calendar_events` are added via SQL. If this realtime was only ever
-- turned on by hand in the Supabase dashboard (or never turned on at
-- all), those subscriptions silently never fire — no error, they just
-- never receive an event, which reads exactly like "the dashboard/
-- pipeline metrics don't update." This closes that gap in code
-- instead of leaving it to whatever the project's dashboard toggles
-- happen to be set to.
--
-- Idempotent — safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'deals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sales_goals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sales_goals;
  END IF;
END $$;

-- Full replica identity on all three — without it, a DELETE's
-- realtime payload only carries the primary key (default replica
-- identity), so the `account_id=eq.${accountId}` filter these
-- subscriptions use would silently drop delete events. Same reasoning
-- as notifications (027) and calendar_events (057).
ALTER TABLE deals REPLICA IDENTITY FULL;
ALTER TABLE contacts REPLICA IDENTITY FULL;
ALTER TABLE sales_goals REPLICA IDENTITY FULL;
