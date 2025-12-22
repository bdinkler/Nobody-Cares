-- ============================================
-- Debug Queries for Community Cohort Hardening
-- These are development-only queries to validate cohort logic
-- DO NOT run in production migrations
-- ============================================

-- A) What cohort am I in this month?
-- Replace auth.uid() with your user_id for testing
SELECT 
  ccm.user_id,
  ccm.cycle_cohort_id,
  cc.cohort_number,
  cc.cycle_id,
  cyc.cycle_month,
  cyc.start_date,
  cyc.end_date,
  ccm.joined_at
FROM public.cycle_cohort_members ccm
JOIN public.cycle_cohorts cc ON ccm.cycle_cohort_id = cc.id
JOIN public.cohort_cycles cyc ON cc.cycle_id = cyc.id
WHERE ccm.user_id = auth.uid()
  AND cyc.cycle_month = DATE_TRUNC('month', CURRENT_DATE)::date
LIMIT 1;

-- B) Month-to-date eligible vs completed breakdown by day for current user
-- Shows day-by-day breakdown for debugging eligibility calculation
WITH month_boundaries AS (
  SELECT 
    DATE_TRUNC('month', CURRENT_DATE)::date AS month_start,
    CURRENT_DATE::date AS today
),
user_tasks AS (
  SELECT id AS task_id, user_id, created_at::date AS task_created_date
  FROM public.tasks
  WHERE user_id = auth.uid() AND is_active = true
),
date_range AS (
  SELECT generate_series(
    (SELECT month_start FROM month_boundaries),
    (SELECT today FROM month_boundaries),
    '1 day'::interval
  )::date AS day_date
),
eligible_per_day AS (
  SELECT 
    dr.day_date,
    COUNT(*) AS eligible_count
  FROM date_range dr
  CROSS JOIN user_tasks ut
  WHERE ut.task_created_date IS NULL OR ut.task_created_date <= dr.day_date
    AND NOT EXISTS (
      SELECT 1 FROM public.task_rests tr
      WHERE tr.user_id = ut.user_id
        AND tr.task_id = ut.task_id
        AND tr.rested_on::date = dr.day_date
    )
  GROUP BY dr.day_date
),
completed_per_day AS (
  SELECT
    completed_on::date AS completion_date,
    COUNT(DISTINCT (task_id, completed_on::date)) AS completed_count
  FROM public.task_completions
  WHERE user_id = auth.uid()
    AND completed_on::date >= (SELECT month_start FROM month_boundaries)
    AND completed_on::date <= (SELECT today FROM month_boundaries)
  GROUP BY completed_on::date
)
SELECT
  COALESCE(epd.day_date, cpd.completion_date) AS date,
  COALESCE(epd.eligible_count, 0) AS eligible,
  COALESCE(cpd.completed_count, 0) AS completed
FROM eligible_per_day epd
FULL OUTER JOIN completed_per_day cpd ON epd.day_date = cpd.completion_date
ORDER BY date;

-- C) Cohort leaderboard rows + pct for current user's cohort
-- Shows all members of the current user's cohort with their month-to-date percentages
WITH current_user_cohort AS (
  SELECT ccm.cycle_cohort_id
  FROM public.cycle_cohort_members ccm
  JOIN public.cycle_cohorts cc ON ccm.cycle_cohort_id = cc.id
  JOIN public.cohort_cycles cyc ON cc.cycle_id = cyc.id
  WHERE ccm.user_id = auth.uid()
    AND cyc.cycle_month = DATE_TRUNC('month', CURRENT_DATE)::date
  LIMIT 1
)
SELECT
  p.first_name,
  p.id AS user_id,
  umc.eligible_instances,
  umc.completed_instances,
  umc.completion_pct,
  umc.window_start,
  umc.window_end
FROM current_user_cohort cuc
JOIN public.cycle_cohort_members ccm ON ccm.cycle_cohort_id = cuc.cycle_cohort_id
LEFT JOIN public.profiles p ON p.id = ccm.user_id
LEFT JOIN public.user_month_to_date_consistency umc ON umc.user_id = ccm.user_id
ORDER BY umc.completion_pct DESC NULLS LAST, umc.completed_instances DESC, ccm.user_id;

