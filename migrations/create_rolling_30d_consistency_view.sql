-- Migration: Create rolling 30-day consistency view
-- Run this in your Supabase SQL Editor

-- ============================================
-- PART A: Ensure indexes exist for performance
-- ============================================

-- task_completions: index for (user_id, task_id, completed_on)
CREATE INDEX IF NOT EXISTS idx_task_completions_user_task_date 
ON public.task_completions(user_id, task_id, completed_on);

-- task_rests: index for (user_id, task_id, rested_on)
CREATE INDEX IF NOT EXISTS idx_task_rests_user_task_date 
ON public.task_rests(user_id, task_id, rested_on);

-- tasks: index on (user_id, is_active) for efficient filtering
CREATE INDEX IF NOT EXISTS idx_tasks_user_active 
ON public.tasks(user_id, is_active);

-- ============================================
-- PART B: Create rolling 30-day consistency view
-- ============================================

-- Drop view if it exists (for re-running migration)
DROP VIEW IF EXISTS public.user_rolling_30d_consistency;

-- Create view for rolling 30-day consistency calculation
-- This view calculates metrics for the last 30 days (rolling window)
CREATE VIEW public.user_rolling_30d_consistency AS
WITH window_bounds AS (
  -- Define the window start and end (30 days: CURRENT_DATE - 29 days to CURRENT_DATE)
  SELECT 
    (CURRENT_DATE - INTERVAL '29 days')::date AS window_start,
    CURRENT_DATE::date AS window_end
),
window_dates AS (
  -- Generate all dates in the rolling 30-day window as DATE type
  SELECT generate_series(
    (SELECT window_start FROM window_bounds),
    (SELECT window_end FROM window_bounds),
    '1 day'::interval
  )::date AS day_date
),
active_tasks AS (
  -- Get all active tasks per user
  SELECT DISTINCT user_id, id AS task_id
  FROM public.tasks
  WHERE is_active = true
),
-- New user fairness: find earliest activity date per user
earliest_task_created AS (
  -- Earliest task created_at date per user (if created_at exists and is not null)
  SELECT 
    user_id,
    MIN(created_at::date) AS earliest_date
  FROM public.tasks
  WHERE is_active = true AND created_at IS NOT NULL
  GROUP BY user_id
),
earliest_completion AS (
  -- Earliest completion date per user
  SELECT 
    user_id,
    MIN(completed_on) AS earliest_date
  FROM public.task_completions
  GROUP BY user_id
),
earliest_rest AS (
  -- Earliest rest date per user
  SELECT 
    user_id,
    MIN(rested_on) AS earliest_date
  FROM public.task_rests
  GROUP BY user_id
),
all_earliest_dates AS (
  -- Combine all earliest dates into one set per user
  SELECT user_id, earliest_date FROM earliest_task_created
  UNION
  SELECT user_id, earliest_date FROM earliest_completion
  UNION
  SELECT user_id, earliest_date FROM earliest_rest
),
user_earliest_activity AS (
  -- Get the minimum earliest date per user
  SELECT 
    user_id,
    MIN(earliest_date) AS earliest_activity_date
  FROM all_earliest_dates
  GROUP BY user_id
),
user_effective_windows AS (
  -- Calculate effective window per user (accounting for new user fairness)
  SELECT 
    at.user_id,
    GREATEST(
      wb.window_start,
      COALESCE(uea.earliest_activity_date, wb.window_start)
    ) AS effective_start,
    wb.window_end AS effective_end,
    -- Flag if effective_start > window_end (user started after window)
    CASE 
      WHEN GREATEST(
        wb.window_start,
        COALESCE(uea.earliest_activity_date, wb.window_start)
      ) > wb.window_end
      THEN true
      ELSE false
    END AS is_outside_window
  FROM active_tasks at
  CROSS JOIN window_bounds wb
  LEFT JOIN user_earliest_activity uea ON uea.user_id = at.user_id
  GROUP BY at.user_id, wb.window_start, wb.window_end, uea.earliest_activity_date
),
-- Generate all possible task instances (user, task, date) for active tasks
-- Only include if effective_start <= window_end
all_task_instances AS (
  SELECT 
    at.user_id,
    at.task_id,
    wd.day_date::date AS instance_date
  FROM active_tasks at
  CROSS JOIN window_dates wd
  INNER JOIN user_effective_windows uew ON (
    at.user_id = uew.user_id
    AND NOT uew.is_outside_window
    AND wd.day_date >= uew.effective_start
    AND wd.day_date <= uew.effective_end
  )
),
-- Get all rested instances in the window (normalized to DATE)
rested_instances AS (
  SELECT 
    user_id,
    task_id,
    rested_on::date AS rest_date
  FROM public.task_rests
  WHERE rested_on::date >= (SELECT window_start FROM window_bounds)
    AND rested_on::date <= (SELECT window_end FROM window_bounds)
),
-- Get all completed instances in the window (normalized to DATE)
completed_instances AS (
  SELECT 
    user_id,
    task_id,
    completed_on::date AS completion_date
  FROM public.task_completions
  WHERE completed_on::date >= (SELECT window_start FROM window_bounds)
    AND completed_on::date <= (SELECT window_end FROM window_bounds)
),
-- Eligible instances = all instances minus rested instances
eligible_instances AS (
  SELECT 
    ati.user_id,
    ati.task_id,
    ati.instance_date
  FROM all_task_instances ati
  LEFT JOIN rested_instances ri ON (
    ati.user_id = ri.user_id 
    AND ati.task_id = ri.task_id 
    AND ati.instance_date = ri.rest_date
  )
  WHERE ri.user_id IS NULL  -- Exclude rested instances
)
-- Final aggregation: count eligible and completed instances
-- Include all users with active tasks, even if they have 0 instances
SELECT 
  uew.user_id,
  (SELECT window_start FROM window_bounds) AS window_start,
  (SELECT window_end FROM window_bounds) AS window_end,
  COALESCE(ei_counts.eligible_count, 0) AS eligible_instances,
  COALESCE(ci_counts.completed_count, 0) AS completed_instances,
  CASE 
    WHEN COALESCE(ei_counts.eligible_count, 0) > 0 
    THEN ROUND(
      (COALESCE(ci_counts.completed_count, 0)::numeric / COALESCE(ei_counts.eligible_count, 0)::numeric) * 100,
      0
    )
    ELSE 0
  END AS completion_pct
FROM user_effective_windows uew
LEFT JOIN (
  SELECT 
    user_id,
    COUNT(*) AS eligible_count
  FROM eligible_instances
  GROUP BY user_id
) ei_counts ON ei_counts.user_id = uew.user_id
LEFT JOIN (
  SELECT 
    ei.user_id,
    COUNT(DISTINCT (ci.user_id, ci.task_id, ci.completion_date)) AS completed_count
  FROM eligible_instances ei
  INNER JOIN completed_instances ci ON (
    ei.user_id = ci.user_id 
    AND ei.task_id = ci.task_id 
    AND ei.instance_date = ci.completion_date
  )
  GROUP BY ei.user_id
) ci_counts ON ci_counts.user_id = uew.user_id;

-- Add comment for documentation
COMMENT ON VIEW public.user_rolling_30d_consistency IS 
'Rolling 30-day consistency metrics per user. Shows eligible instances (excluding rests), completed instances, and completion percentage for the last 30 days. Includes new user fairness: only counts days since user first had active tasks.';

-- ============================================
-- PART C: RLS for the view
-- ============================================

-- Set security invoker so RLS is respected from underlying tables
ALTER VIEW public.user_rolling_30d_consistency SET (security_invoker = true);

-- Note: The view will automatically respect RLS policies from:
-- - tasks (RLS checks auth.uid() = user_id)
-- - task_completions (RLS checks auth.uid() = user_id)
-- - task_rests (RLS checks auth.uid() = user_id)
-- Users can only see their own consistency data.
