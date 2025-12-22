-- ============================================
-- Migration: Create user_monthly_cohort_consistency view
-- - Monthly consistency per user within their cohort for CURRENT calendar month
-- - Only counts from member join date or month start (whichever is later) to today
-- - Excludes rested task-days from eligibility
-- - Uses security_invoker = true for RLS
-- ============================================

-- PART A: Ensure indexes exist (reuse from rolling view if present)
CREATE INDEX IF NOT EXISTS idx_task_completions_user_task_date 
ON public.task_completions(user_id, task_id, completed_on);

CREATE INDEX IF NOT EXISTS idx_task_rests_user_task_date 
ON public.task_rests(user_id, task_id, rested_on);

CREATE INDEX IF NOT EXISTS idx_tasks_user_active 
ON public.tasks(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_cycle_cohort_members_cohort_user
ON public.cycle_cohort_members(cycle_cohort_id, user_id);

-- PART B: Create monthly cohort consistency view
DROP VIEW IF EXISTS public.user_monthly_cohort_consistency;

CREATE VIEW public.user_monthly_cohort_consistency AS
WITH current_month AS (
  SELECT 
    DATE_TRUNC('month', CURRENT_DATE)::date AS month_start,
    CURRENT_DATE::date AS month_end
),
month_dates AS (
  SELECT generate_series(
    (SELECT month_start FROM current_month),
    (SELECT month_end FROM current_month),
    '1 day'::interval
  )::date AS day_date
),
-- Active tasks per user
active_tasks AS (
  SELECT user_id, id AS task_id, created_at
  FROM public.tasks
  WHERE is_active = true
),
-- Cohort members with their join dates
cohort_members AS (
  SELECT 
    ccm.cycle_cohort_id,
    ccm.user_id,
    ccm.joined_at::date AS joined_date
  FROM public.cycle_cohort_members ccm
),
-- Effective start date per user: GREATEST(month_start, joined_date)
-- Only count from when they joined the cohort (or month start if joined earlier)
user_effective_start AS (
  SELECT
    cm.cycle_cohort_id,
    cm.user_id,
    GREATEST(
      (SELECT month_start FROM current_month),
      COALESCE(cm.joined_date, (SELECT month_start FROM current_month))
    ) AS effective_start,
    (SELECT month_end FROM current_month) AS effective_end
  FROM cohort_members cm
  WHERE EXISTS (
    SELECT 1 FROM active_tasks at WHERE at.user_id = cm.user_id
  )
),
-- All possible eligible task instances (user, task, day) in the effective window
-- Task must be active AND (created_at is null OR created_at <= day_date)
all_task_instances AS (
  SELECT
    ues.cycle_cohort_id,
    at.user_id,
    at.task_id,
    md.day_date AS instance_date
  FROM user_effective_start ues
  JOIN active_tasks at ON at.user_id = ues.user_id
  JOIN month_dates md ON md.day_date BETWEEN ues.effective_start AND ues.effective_end
  WHERE at.created_at IS NULL OR at.created_at::date <= md.day_date
),
-- Rested instances in the current month
rested_instances AS (
  SELECT
    user_id,
    task_id,
    rested_on::date AS rest_date
  FROM public.task_rests
  WHERE rested_on::date BETWEEN (SELECT month_start FROM current_month) AND (SELECT month_end FROM current_month)
),
-- Completed instances in the current month
completed_instances AS (
  SELECT
    user_id,
    task_id,
    completed_on::date AS completion_date
  FROM public.task_completions
  WHERE completed_on::date BETWEEN (SELECT month_start FROM current_month) AND (SELECT month_end FROM current_month)
),
-- Eligible instances = all_task_instances minus rested_instances
eligible_instances AS (
  SELECT
    ati.cycle_cohort_id,
    ati.user_id,
    ati.task_id,
    ati.instance_date
  FROM all_task_instances ati
  LEFT JOIN rested_instances ri ON (
    ati.user_id = ri.user_id
    AND ati.task_id = ri.task_id
    AND ati.instance_date = ri.rest_date
  )
  WHERE ri.user_id IS NULL
),
-- Count eligible instances per (cohort, user)
eligible_counts AS (
  SELECT
    cycle_cohort_id,
    user_id,
    COUNT(*) AS eligible_count
  FROM eligible_instances
  GROUP BY cycle_cohort_id, user_id
),
-- Count completed instances per (cohort, user)
-- Match eligible instances with completions
completed_counts AS (
  SELECT
    ei.cycle_cohort_id,
    ei.user_id,
    COUNT(DISTINCT (ci.user_id, ci.task_id, ci.completion_date)) AS completed_count
  FROM eligible_instances ei
  JOIN completed_instances ci ON (
    ei.user_id = ci.user_id
    AND ei.task_id = ci.task_id
    AND ei.instance_date = ci.completion_date
  )
  GROUP BY ei.cycle_cohort_id, ei.user_id
)
SELECT
  ues.cycle_cohort_id,
  ues.user_id,
  (SELECT month_start FROM current_month) AS month_start,
  (SELECT month_end FROM current_month) AS month_end,
  COALESCE(ec.eligible_count, 0) AS eligible_instances,
  COALESCE(cc.completed_count, 0) AS completed_instances,
  CASE
    WHEN COALESCE(ec.eligible_count, 0) > 0
    THEN ROUND((COALESCE(cc.completed_count, 0)::numeric / ec.eligible_count::numeric) * 100, 0)
    ELSE 0
  END AS completion_pct
FROM user_effective_start ues
LEFT JOIN eligible_counts ec ON (
  ec.cycle_cohort_id = ues.cycle_cohort_id
  AND ec.user_id = ues.user_id
)
LEFT JOIN completed_counts cc ON (
  cc.cycle_cohort_id = ues.cycle_cohort_id
  AND cc.user_id = ues.user_id
);

COMMENT ON VIEW public.user_monthly_cohort_consistency IS
'Monthly consistency per user within their cohort for the current calendar month. Only counts from member join date (or month start, whichever is later) to today. Eligibility = active tasks × days in month minus rests. Completion percentage is 0-100.';

ALTER VIEW public.user_monthly_cohort_consistency SET (security_invoker = true);

-- PART C: Create cohort member counts view
DROP VIEW IF EXISTS public.cycle_cohort_member_counts;

CREATE VIEW public.cycle_cohort_member_counts AS
SELECT
  cycle_cohort_id,
  COUNT(DISTINCT user_id) AS member_count
FROM public.cycle_cohort_members
GROUP BY cycle_cohort_id;

COMMENT ON VIEW public.cycle_cohort_member_counts IS
'Member count per cohort cycle.';

ALTER VIEW public.cycle_cohort_member_counts SET (security_invoker = true);

