-- Debug queries for streak calculation
-- Run these in Supabase SQL Editor to diagnose streak issues
-- Replace 'YOUR_USER_ID_HERE' with your actual user ID from auth.users (must be valid UUID format)

-- 1. Check if view returns data (use auth.uid() if available, or cast your UUID properly)
SELECT * FROM user_execution_streaks WHERE user_id = auth.uid();
-- OR if auth.uid() doesn't work in SQL Editor, use:
-- SELECT * FROM user_execution_streaks WHERE user_id = 'YOUR_USER_ID_HERE'::uuid;

-- 2. Check your active tasks (with date analysis)
-- First check if auth.uid() works
SELECT 
  auth.uid() AS current_user_id,
  (SELECT COUNT(*) FROM tasks WHERE user_id = auth.uid()) AS total_tasks_any_status,
  (SELECT COUNT(*) FROM tasks WHERE user_id = auth.uid() AND is_active = true) AS active_tasks_count;

-- Then get task details (if auth.uid() works)
SELECT 
  id, 
  title, 
  is_active, 
  created_at,
  created_at::date AS created_date,
  (CURRENT_DATE - INTERVAL '1 day')::date AS yesterday_date,
  CASE 
    WHEN created_at IS NULL THEN 'NULL - will be included'
    WHEN created_at::date <= (CURRENT_DATE - INTERVAL '1 day')::date THEN 'ELIGIBLE for yesterday'
    ELSE 'NOT eligible (created today or later)'
  END AS eligibility_status
FROM tasks 
WHERE user_id = auth.uid()
  AND is_active = true;
-- OR if auth.uid() is NULL, use: WHERE user_id = 'YOUR_USER_ID_HERE'::uuid

-- 3. Check your completions (last 10 days)
SELECT 
  completed_on, 
  task_id,
  COUNT(*) as count
FROM task_completions 
WHERE user_id = auth.uid()
  AND completed_on >= (CURRENT_DATE - INTERVAL '10 days')::date
GROUP BY completed_on, task_id
ORDER BY completed_on DESC;
-- OR: WHERE user_id = 'YOUR_USER_ID_HERE'::uuid

-- 4. Check eligible vs completed for yesterday (with detailed breakdown)
WITH yesterday AS (
  SELECT (CURRENT_DATE - INTERVAL '1 day')::date AS day_date
),
all_active_tasks AS (
  SELECT id AS task_id, created_at, created_at::date AS created_date
  FROM tasks 
  WHERE user_id = auth.uid()
    AND is_active = true
),
active_tasks AS (
  SELECT task_id, created_at, created_date
  FROM all_active_tasks
  WHERE created_at IS NULL OR created_at::date <= (SELECT day_date FROM yesterday)
),
rested AS (
  SELECT task_id 
  FROM task_rests 
  WHERE user_id = auth.uid()
    AND rested_on = (SELECT day_date FROM yesterday)
),
eligible AS (
  SELECT task_id 
  FROM active_tasks 
  WHERE task_id NOT IN (SELECT task_id FROM rested)
),
completed AS (
  SELECT task_id 
  FROM task_completions 
  WHERE user_id = auth.uid()
    AND completed_on = (SELECT day_date FROM yesterday)
    AND task_id IN (SELECT task_id FROM eligible)
)
SELECT 
  (SELECT COUNT(*) FROM all_active_tasks) AS total_active_tasks,
  (SELECT COUNT(*) FROM active_tasks) AS tasks_eligible_for_yesterday,
  (SELECT COUNT(*) FROM rested) AS tasks_rested_yesterday,
  (SELECT COUNT(*) FROM eligible) AS eligible_count,
  (SELECT COUNT(*) FROM completed) AS completed_count,
  CASE 
    WHEN (SELECT COUNT(*) FROM eligible) > 0 
      AND (SELECT COUNT(*) FROM completed) = (SELECT COUNT(*) FROM eligible)
    THEN 'EXECUTED'
    ELSE 'NOT EXECUTED'
  END AS status,
  (SELECT day_date FROM yesterday) AS yesterday_date,
  CURRENT_DATE AS today_date;

-- 5. Check all executed days in last 30 days
WITH yesterday AS (
  SELECT (CURRENT_DATE - INTERVAL '1 day')::date AS as_of_date
),
date_range AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '30 days')::date,
    (SELECT as_of_date FROM yesterday),
    '1 day'::interval
  )::date AS day_date
),
active_tasks AS (
  SELECT id AS task_id, created_at
  FROM tasks 
  WHERE user_id = auth.uid()
    AND is_active = true
),
user_task_dates AS (
  SELECT 
    at.task_id,
    dr.day_date
  FROM active_tasks at
  CROSS JOIN date_range dr
  WHERE at.created_at IS NULL OR at.created_at::date <= dr.day_date
),
rested AS (
  SELECT task_id, rested_on AS day_date
  FROM task_rests 
  WHERE user_id = auth.uid()
    AND rested_on <= (SELECT as_of_date FROM yesterday)
),
eligible AS (
  SELECT 
    utd.day_date,
    utd.task_id
  FROM user_task_dates utd
  LEFT JOIN rested r ON (
    utd.task_id = r.task_id
    AND utd.day_date = r.day_date
  )
  WHERE r.task_id IS NULL
),
eligible_counts AS (
  SELECT 
    day_date,
    COUNT(*) AS eligible_count
  FROM eligible
  GROUP BY day_date
),
completed_counts AS (
  SELECT 
    ei.day_date,
    COUNT(DISTINCT ac.task_id) AS completed_count
  FROM eligible ei
  LEFT JOIN task_completions ac ON (
    ac.user_id = auth.uid()
    AND ac.task_id = ei.task_id
    AND ac.completed_on = ei.day_date
  )
  GROUP BY ei.day_date
)
SELECT 
  ec.day_date,
  ec.eligible_count,
  COALESCE(cc.completed_count, 0) AS completed_count,
  CASE 
    WHEN ec.eligible_count > 0 
      AND COALESCE(cc.completed_count, 0) = ec.eligible_count
    THEN 'EXECUTED'
    ELSE 'NOT EXECUTED'
  END AS status
FROM eligible_counts ec
LEFT JOIN completed_counts cc ON ec.day_date = cc.day_date
ORDER BY ec.day_date DESC;

