-- Migration: Create indexes and monthly consistency view
-- Run this in your Supabase SQL Editor

-- ============================================
-- PART A: Add/confirm indexes for month queries
-- ============================================

-- task_completions: additional index for (user_id, task_id, completed_on)
-- (user_id, completed_on) already exists from create_task_completions_table.sql
CREATE INDEX IF NOT EXISTS idx_task_completions_user_task_date 
ON public.task_completions(user_id, task_id, completed_on);

-- task_rests: additional index for (user_id, task_id, rested_on)
-- (user_id, rested_on) already exists from create_task_rests_table.sql
CREATE INDEX IF NOT EXISTS idx_task_rests_user_task_date 
ON public.task_rests(user_id, task_id, rested_on);

-- tasks: index on (user_id, is_active) for efficient filtering
CREATE INDEX IF NOT EXISTS idx_tasks_user_active 
ON public.tasks(user_id, is_active);

-- ============================================
-- PART B: Create monthly consistency view
-- ============================================

-- Drop view if it exists (for re-running migration)
DROP VIEW IF EXISTS public.user_monthly_consistency;

-- Create view for monthly consistency calculation
-- This view calculates metrics for the current calendar month
CREATE VIEW public.user_monthly_consistency AS
WITH month_dates AS (
  -- Generate all dates in the current month
  SELECT generate_series(
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
    '1 day'::interval
  )::date AS date_in_month
),
active_tasks AS (
  -- Get all active tasks per user
  SELECT user_id, id AS task_id
  FROM public.tasks
  WHERE is_active = true
),
all_instances AS (
  -- Generate all possible task instances (user, task, date) for active tasks
  SELECT 
    at.user_id,
    at.task_id,
    md.date_in_month AS instance_date
  FROM active_tasks at
  CROSS JOIN month_dates md
),
rested_instances AS (
  -- Get all rested instances in the current month
  SELECT 
    user_id,
    task_id,
    rested_on AS instance_date
  FROM public.task_rests
  WHERE rested_on >= date_trunc('month', CURRENT_DATE)::date
    AND rested_on <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
),
completed_instances AS (
  -- Get all completed instances in the current month
  SELECT 
    user_id,
    task_id,
    completed_on AS instance_date
  FROM public.task_completions
  WHERE completed_on >= date_trunc('month', CURRENT_DATE)::date
    AND completed_on <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
),
eligible_instances AS (
  -- Eligible instances = all instances minus rested instances
  SELECT 
    ai.user_id,
    ai.task_id,
    ai.instance_date
  FROM all_instances ai
  LEFT JOIN rested_instances ri ON (
    ai.user_id = ri.user_id 
    AND ai.task_id = ri.task_id 
    AND ai.instance_date = ri.instance_date
  )
  WHERE ri.user_id IS NULL  -- Exclude rested instances
)
SELECT 
  ei.user_id,
  date_trunc('month', CURRENT_DATE)::date AS month_start,
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date AS month_end,
  COUNT(*) AS eligible_instances,
  COUNT(ci.user_id) AS completed_instances,
  CASE 
    WHEN COUNT(*) > 0 
    THEN ROUND(
      (COUNT(ci.user_id)::numeric / COUNT(*)::numeric) * 100,
      0
    )
    ELSE 0
  END AS completion_pct
FROM eligible_instances ei
LEFT JOIN completed_instances ci ON (
  ei.user_id = ci.user_id 
  AND ei.task_id = ci.task_id 
  AND ei.instance_date = ci.instance_date
)
GROUP BY ei.user_id;

-- Add comment for documentation
COMMENT ON VIEW public.user_monthly_consistency IS 
'Monthly consistency metrics per user. Shows eligible instances (excluding rests), completed instances, and completion percentage for the current month.';

-- ============================================
-- PART C: RLS for the view
-- ============================================

-- Enable RLS on the view (views inherit RLS from underlying tables)
-- Since the view queries tasks, task_completions, and task_rests which all have RLS,
-- the view will automatically respect RLS policies. Users can only see their own data.

-- However, we should add a security definer function or ensure the view works with RLS.
-- The view will work correctly because:
-- 1. All underlying tables have RLS enabled
-- 2. All RLS policies check auth.uid() = user_id
-- 3. The view filters by user_id, so RLS will naturally restrict results

-- For explicit security, we can add a policy on the view itself:
ALTER VIEW public.user_monthly_consistency SET (security_invoker = true);

-- Note: In Supabase, views with security_invoker = true will use the current user's
-- RLS context when querying underlying tables, which is what we want.

