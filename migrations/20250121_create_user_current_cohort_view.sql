-- ============================================
-- Migration: Create user_current_cohort view
-- - Returns the current month cohort membership for each user
-- - Filters to current calendar month cycle only
-- - Uses security_invoker = true for RLS
-- ============================================

DROP VIEW IF EXISTS public.user_current_cohort;

CREATE VIEW public.user_current_cohort AS
WITH current_month_cycle AS (
  SELECT id AS cycle_id
  FROM public.cohort_cycles
  WHERE start_date = DATE_TRUNC('month', CURRENT_DATE)::date
    AND end_date = (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
  LIMIT 1
),
current_month_cohorts AS (
  SELECT id AS cycle_cohort_id
  FROM public.cycle_cohorts cc
  INNER JOIN current_month_cycle cmc ON cc.cycle_id = cmc.cycle_id
)
SELECT
  ccm.user_id,
  ccm.cycle_cohort_id,
  ccm.joined_at,
  cc.cycle_id,
  cyc.start_date AS cycle_start_date,
  cyc.end_date AS cycle_end_date
FROM public.cycle_cohort_members ccm
INNER JOIN current_month_cohorts cmco ON ccm.cycle_cohort_id = cmco.cycle_cohort_id
INNER JOIN public.cycle_cohorts cc ON ccm.cycle_cohort_id = cc.id
INNER JOIN public.cohort_cycles cyc ON cc.cycle_id = cyc.id;

COMMENT ON VIEW public.user_current_cohort IS
'Current month cohort membership per user. Returns only memberships for the current calendar month cycle (filtered by start_date/end_date).';

ALTER VIEW public.user_current_cohort SET (security_invoker = true);

