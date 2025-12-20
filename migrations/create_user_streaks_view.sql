-- Migration: Create user_execution_streaks view (SIMPLIFIED & FIXED)
-- Run this in your Supabase SQL Editor

-- ============================================
-- PART A: Ensure indexes exist for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_task_completions_user_date 
ON public.task_completions(user_id, completed_on);

CREATE INDEX IF NOT EXISTS idx_task_rests_user_date 
ON public.task_rests(user_id, rested_on);

CREATE INDEX IF NOT EXISTS idx_tasks_user_active 
ON public.tasks(user_id, is_active);

-- ============================================
-- PART B: Create user_execution_streaks view
-- ============================================

DROP VIEW IF EXISTS public.user_execution_streaks;

CREATE VIEW public.user_execution_streaks AS
WITH yesterday AS (
  SELECT (CURRENT_DATE - INTERVAL '1 day')::date AS as_of_date
),
-- Simple date range: last 365 days up to yesterday
date_range AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '365 days')::date,
    (SELECT as_of_date FROM yesterday),
    '1 day'::interval
  )::date AS day_date
),
-- Get all users who have active tasks
users_with_tasks AS (
  SELECT DISTINCT user_id
  FROM public.tasks
  WHERE is_active = true
),
-- Get all active tasks
active_tasks AS (
  SELECT user_id, id AS task_id, created_at
  FROM public.tasks
  WHERE is_active = true
),
-- Get dates where tasks had completions (tasks must have existed on those dates)
tasks_with_completions AS (
  SELECT DISTINCT
    tc.user_id,
    tc.task_id,
    tc.completed_on AS day_date
  FROM public.task_completions tc
  INNER JOIN active_tasks at ON (
    tc.user_id = at.user_id
    AND tc.task_id = at.task_id
  )
  WHERE tc.completed_on <= (SELECT as_of_date FROM yesterday)
),
-- For each user, get all dates where they have active tasks
-- A task is eligible on a date if:
-- 1. It was created on or before that date, OR
-- 2. It has a completion on that date (proving it existed then)
user_task_dates AS (
  SELECT 
    at.user_id,
    dr.day_date,
    at.task_id
  FROM active_tasks at
  CROSS JOIN date_range dr
  WHERE (
    at.created_at IS NULL 
    OR at.created_at::date <= dr.day_date
    OR EXISTS (
      SELECT 1 
      FROM tasks_with_completions twc
      WHERE twc.user_id = at.user_id
        AND twc.task_id = at.task_id
        AND twc.day_date = dr.day_date
    )
  )
),
-- Get all rested task instances
rested_instances AS (
  SELECT 
    user_id,
    task_id,
    rested_on AS day_date
  FROM public.task_rests
  WHERE rested_on <= (SELECT as_of_date FROM yesterday)
),
-- Eligible tasks = active tasks minus rested tasks
eligible_instances AS (
  SELECT 
    utd.user_id,
    utd.day_date,
    utd.task_id
  FROM user_task_dates utd
  LEFT JOIN rested_instances ri ON (
    utd.user_id = ri.user_id
    AND utd.task_id = ri.task_id
    AND utd.day_date = ri.day_date
  )
  WHERE ri.user_id IS NULL  -- Exclude rested tasks
),
-- Count eligible tasks per user per day
eligible_counts AS (
  SELECT 
    user_id,
    day_date,
    COUNT(*) AS eligible_count
  FROM eligible_instances
  GROUP BY user_id, day_date
),
-- Get all completions (only for dates <= yesterday)
all_completions AS (
  SELECT 
    user_id,
    task_id,
    completed_on AS day_date
  FROM public.task_completions
  WHERE completed_on <= (SELECT as_of_date FROM yesterday)
),
-- Count completed tasks per user per day (only for eligible tasks)
-- This ensures we only count completions for tasks that were eligible
completed_counts AS (
  SELECT 
    ei.user_id,
    ei.day_date,
    COUNT(DISTINCT CASE WHEN ac.task_id IS NOT NULL THEN ac.task_id END) AS completed_count
  FROM eligible_instances ei
  LEFT JOIN all_completions ac ON (
    ei.user_id = ac.user_id
    AND ei.task_id = ac.task_id
    AND ei.day_date = ac.day_date
  )
  GROUP BY ei.user_id, ei.day_date
),
-- Determine which days are executed (100% completion)
executed_days AS (
  SELECT 
    ec.user_id,
    ec.day_date,
    ec.eligible_count,
    COALESCE(cc.completed_count, 0) AS completed_count,
    CASE 
      WHEN ec.eligible_count > 0 
        AND COALESCE(cc.completed_count, 0) = ec.eligible_count
      THEN true
      ELSE false
    END AS is_executed
  FROM eligible_counts ec
  LEFT JOIN completed_counts cc ON (
    ec.user_id = cc.user_id
    AND ec.day_date = cc.day_date
  )
),
-- Filter to only executed days
executed_days_only AS (
  SELECT 
    user_id,
    day_date
  FROM executed_days
  WHERE is_executed = true
),
-- Group consecutive executed days into streaks
-- Use the date - row_number trick to identify consecutive groups
streak_groups AS (
  SELECT 
    user_id,
    day_date,
    day_date - ROW_NUMBER() OVER (
      PARTITION BY user_id 
      ORDER BY day_date
    )::integer AS streak_group
  FROM executed_days_only
),
-- Calculate streak lengths
streak_lengths AS (
  SELECT 
    user_id,
    streak_group,
    MIN(day_date) AS streak_start,
    MAX(day_date) AS streak_end,
    COUNT(*) AS streak_length
  FROM streak_groups
  GROUP BY user_id, streak_group
),
-- Find current streak (ending at yesterday)
current_streaks AS (
  SELECT 
    user_id,
    streak_length AS current_streak_days
  FROM streak_lengths
  WHERE streak_end = (SELECT as_of_date FROM yesterday)
),
-- Find best streak (max length) - handle NULL case
best_streaks AS (
  SELECT 
    user_id,
    COALESCE(MAX(streak_length), 0) AS best_streak_days
  FROM streak_lengths
  GROUP BY user_id
)
-- Final result: one row per user with active tasks
SELECT 
  uwt.user_id,
  COALESCE(cs.current_streak_days, 0) AS current_streak_days,
  COALESCE(bs.best_streak_days, 0) AS best_streak_days,
  (SELECT as_of_date FROM yesterday) AS as_of_date
FROM users_with_tasks uwt
LEFT JOIN current_streaks cs ON cs.user_id = uwt.user_id
LEFT JOIN best_streaks bs ON bs.user_id = uwt.user_id;

COMMENT ON VIEW public.user_execution_streaks IS 
'User execution streaks. Current streak is consecutive executed days ending at yesterday. Best streak is the longest consecutive executed days in history. A day is executed if 100% of eligible tasks (excluding rested tasks) are completed. Today is excluded from calculations.';

ALTER VIEW public.user_execution_streaks SET (security_invoker = true);
