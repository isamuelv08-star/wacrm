-- ============================================================
-- 071_notifications_delete_policy.sql — let a recipient delete their
-- own notifications.
--
-- Reported complaint: read notifications just pile up forever, taking
-- up space (and, per the user, "memoria") in the feed with no way to
-- clear them out — marking them read left the rows sitting there
-- indefinitely. The Notifications page's "mark all as read" action now
-- deletes the rows outright instead of only setting `read_at`.
--
-- No DELETE policy existed at all before this — migration 027
-- deliberately omitted one, back when the only client action was
-- marking a row read ("No client INSERT/DELETE policy — rows are
-- created exclusively by the SECURITY DEFINER trigger function
-- below."). Add the same recipient-scoped rule the existing
-- SELECT/UPDATE policies already use.
-- ============================================================

DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications FOR DELETE
  USING (auth.uid() = user_id);

GRANT DELETE ON notifications TO authenticated;
