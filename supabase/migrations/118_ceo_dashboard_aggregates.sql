-- ============================================================
-- 118 — CEO dashboard aggregates computed in the database
-- ============================================================
--
-- src/lib/dashboard/ceo-queries.ts used to download every deal row a
-- KPI needed (paging through 1000 at a time) just to sum / count /
-- average them in Node. Fine at a few hundred deals; with tens of
-- thousands every dashboard load (and every sales-intelligence cron
-- tick) moved all of them over the wire. These functions return only
-- the totals.
--
-- All SECURITY INVOKER: RLS still applies to the caller. The account is
-- `p_account_id` when given (service-role callers: the risk-engine
-- cron), else the caller's own (profiles.account_id — the membership
-- source of truth since migration 017). No account → no rows.
--
-- Semantics mirror the TypeScript they replace, 1:1 (see each
-- function's caller for the field-by-field meaning).
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ceo_account(p_account_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT coalesce(p_account_id, (SELECT account_id FROM profiles WHERE user_id = auth.uid()))
$$;

-- Won/lost deals closed in [p_from, p_to), split at p_split into a
-- 'previous' and a 'current' half: counts, won value, average sales
-- cycle (days, won deals, negative cycles ignored). Also the lost value.
CREATE OR REPLACE FUNCTION public.ceo_closed_stats(
  p_account_id uuid,
  p_from       timestamptz,
  p_split      timestamptz,
  p_to         timestamptz
)
RETURNS TABLE (half text, won_count bigint, lost_count bigint, won_value numeric, lost_value numeric, avg_cycle_days double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT CASE WHEN d.closed_at < p_split THEN 'previous' ELSE 'current' END,
         count(*) FILTER (WHERE d.status = 'won'),
         count(*) FILTER (WHERE d.status = 'lost'),
         coalesce(sum(coalesce(d.value, 0)) FILTER (WHERE d.status = 'won'), 0),
         coalesce(sum(coalesce(d.value, 0)) FILTER (WHERE d.status = 'lost'), 0),
         avg(extract(epoch FROM (d.closed_at - d.created_at)) / 86400.0)
           FILTER (WHERE d.status = 'won' AND d.closed_at >= d.created_at)
  FROM deals d
  WHERE d.account_id = ceo_account(p_account_id)
    AND d.status IN ('won', 'lost')
    AND d.closed_at >= p_from
    AND d.closed_at < p_to
  GROUP BY 1
$$;

-- Current-state snapshot + deal / client counts for two windows:
-- previous = [p_prev_start, p_cur_start), current = [p_cur_start, p_cur_end).
CREATE OR REPLACE FUNCTION public.ceo_snapshot(
  p_account_id uuid,
  p_prev_start timestamptz,
  p_cur_start  timestamptz,
  p_cur_end    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v uuid := ceo_account(p_account_id);
  r jsonb;
BEGIN
  SELECT jsonb_build_object(
    'pipeline_total', coalesce(sum(coalesce(d.value, 0)) FILTER (WHERE d.status = 'open'), 0),
    'forecast', coalesce(sum(coalesce(d.value, 0) * s.win_probability / 100.0)
                  FILTER (WHERE d.status = 'open' AND s.win_probability IS NOT NULL), 0),
    'total_clients', count(DISTINCT d.contact_id),
    'new_clients_current', count(DISTINCT d.contact_id)
                  FILTER (WHERE d.created_at >= p_cur_start AND d.created_at < p_cur_end),
    'new_clients_previous', count(DISTINCT d.contact_id)
                  FILTER (WHERE d.created_at >= p_prev_start AND d.created_at < p_cur_start),
    'created_current', count(*) FILTER (WHERE d.created_at >= p_cur_start AND d.created_at < p_cur_end),
    'created_previous', count(*) FILTER (WHERE d.created_at >= p_prev_start AND d.created_at < p_cur_start)
  )
  INTO r
  FROM deals d
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  WHERE d.account_id = v;
  RETURN r;
END;
$$;

-- Won revenue per bucket; p_edges = ascending bucket boundaries
-- (n + 1 edges for n buckets). bucket = 1..n.
CREATE OR REPLACE FUNCTION public.ceo_won_by_bucket(p_account_id uuid, p_edges timestamptz[])
RETURNS TABLE (bucket integer, total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT width_bucket(d.closed_at, p_edges), sum(coalesce(d.value, 0))
  FROM deals d
  WHERE d.account_id = ceo_account(p_account_id)
    AND d.status = 'won'
    AND d.closed_at >= p_edges[1]
    AND d.closed_at < p_edges[array_length(p_edges, 1)]
  GROUP BY 1
$$;

-- Per assigned member: won/lost counts and won value, previous/current
-- halves (same windows as ceo_closed_stats).
CREATE OR REPLACE FUNCTION public.ceo_seller_closed_stats(
  p_account_id uuid,
  p_from       timestamptz,
  p_split      timestamptz,
  p_to         timestamptz
)
RETURNS TABLE (
  assigned_to uuid,
  won_current bigint, lost_current bigint, won_previous bigint, lost_previous bigint,
  value_won_current numeric, value_won_previous numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT d.assigned_to,
         count(*) FILTER (WHERE d.status = 'won'  AND d.closed_at >= p_split),
         count(*) FILTER (WHERE d.status = 'lost' AND d.closed_at >= p_split),
         count(*) FILTER (WHERE d.status = 'won'  AND d.closed_at <  p_split),
         count(*) FILTER (WHERE d.status = 'lost' AND d.closed_at <  p_split),
         coalesce(sum(coalesce(d.value, 0)) FILTER (WHERE d.status = 'won' AND d.closed_at >= p_split), 0),
         coalesce(sum(coalesce(d.value, 0)) FILTER (WHERE d.status = 'won' AND d.closed_at <  p_split), 0)
  FROM deals d
  WHERE d.account_id = ceo_account(p_account_id)
    AND d.assigned_to IS NOT NULL
    AND d.status IN ('won', 'lost')
    AND d.closed_at >= p_from
    AND d.closed_at < p_to
  GROUP BY d.assigned_to
$$;

-- Who owns what right now: open (not closed) conversations per
-- assigned agent (auth user id) and open deals per owner (profile id).
CREATE OR REPLACE FUNCTION public.ceo_leads_by_rep(p_account_id uuid)
RETURNS TABLE (kind text, member_id uuid, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT 'conversation', c.assigned_agent_id, count(*)
  FROM conversations c
  WHERE c.account_id = ceo_account(p_account_id)
    AND c.status <> 'closed'
    AND c.assigned_agent_id IS NOT NULL
  GROUP BY c.assigned_agent_id
  UNION ALL
  SELECT 'deal', d.assigned_to, count(*)
  FROM deals d
  WHERE d.account_id = ceo_account(p_account_id)
    AND d.status = 'open'
    AND d.assigned_to IS NOT NULL
  GROUP BY d.assigned_to
$$;

-- Funnel: distinct deals that reached each stage since p_since, and the
-- summed current value of those deals.
CREATE OR REPLACE FUNCTION public.ceo_funnel_stages(p_account_id uuid, p_since timestamptz)
RETURNS TABLE (stage_id uuid, deal_count bigint, deal_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT h.to_stage_id, count(*), coalesce(sum(coalesce(d.value, 0)), 0)
  FROM (
    SELECT DISTINCT deal_id, to_stage_id
    FROM deal_stage_history
    WHERE account_id = ceo_account(p_account_id)
      AND changed_at >= p_since
  ) h
  LEFT JOIN deals d ON d.id = h.deal_id
  GROUP BY h.to_stage_id
$$;

-- Supporting index: won/lost by close date per account (the closed-stats
-- windows). 117 added (account_id, status); this one ranges on closed_at.
CREATE INDEX IF NOT EXISTS idx_deals_account_status_closed
  ON deals (account_id, status, closed_at);

REVOKE ALL ON FUNCTION public.ceo_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_closed_stats(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_snapshot(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_won_by_bucket(uuid, timestamptz[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_seller_closed_stats(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_leads_by_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_funnel_stages(uuid, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ceo_account(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ceo_closed_stats(uuid, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ceo_snapshot(uuid, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ceo_won_by_bucket(uuid, timestamptz[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ceo_seller_closed_stats(uuid, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ceo_leads_by_rep(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ceo_funnel_stages(uuid, timestamptz) TO authenticated, service_role;
