-- Migration: Fix calendar date boundaries in rolling 30d consistency view
-- Problem: View uses CURRENT_DATE (server timezone) which can be ahead of user's local time
-- Solution: Use CURRENT_DATE for eligibility but cap window at latest completion + 1 day
-- This ensures:
-- 1. New days are eligible even if user hasn't logged in yet (for midnight missed task tracking)
-- 2. We don't prematurely include dates beyond user's actual "today" due to timezone differences
-- 3. At midnight, missed tasks can be recorded for the day that just ended

DROP VIEW IF EXISTS public.user_rolling_30d_consistency;

CREATE VIEW public.user_rolling_30d_consistency AS
WITH 
-- Get the latest completion date per user (their actual "today" based on activity)
latest_completion_per_user AS (
  SELECT 
    user_id,
    MAX(completed_on)::date AS latest_completion_date
  FROM public.task_completions
  GROUP BY user_id
),
-- Window bounds: Use CURRENT_DATE but cap at latest completion + 1 day
-- This prevents timezone issues while still allowing new days to be eligible
window_bounds AS (
  SELECT 
    t.user_id,
    (CURRENT_DATE - INTERVAL '29 days')::date AS window_start,
    -- Cap window_end to prevent premature inclusion of future dates
    -- The +1 day handles timezone edge cases (server ahead of user)
    LEAST(
      CURRENT_DATE::date,
      COALESCE(lcp.latest_completion_date, CURRENT_DATE::date) + 1
    ) AS window_end
  FROM (SELECT DISTINCT user_id FROM public.tasks WHERE is_active = true) t
  LEFT JOIN latest_completion_per_user lcp ON lcp.user_id = t.user_id
),
window_dates AS (
  SELECT 
    wb.user_id,
    generate_series(
      wb.window_start,
      wb.window_end,
      '1 day'::interval
    )::date AS day_date
  FROM window_bounds wb
),
active_tasks AS (
  SELECT user_id, id AS task_id
  FROM public.tasks
  WHERE is_active = true
),
-- First activity day for fairness (only to avoid counting days before they started)
first_activity AS (
  SELECT
    u.user_id,
    MIN(u.first_day)::date AS first_activity_day
  FROM (
    SELECT user_id, MIN(completed_on)::date AS first_day
    FROM public.task_completions
    GROUP BY user_id

    UNION ALL

    SELECT user_id, MIN(rested_on)::date AS first_day
    FROM public.task_rests
    GROUP BY user_id

    UNION ALL

    SELECT user_id, MIN(created_at)::date AS first_day
    FROM public.tasks
    WHERE created_at IS NOT NULL
    GROUP BY user_id
  ) u
  GROUP BY u.user_id
),
user_effective_window AS (
  SELECT
    at.user_id,
    GREATEST(
      wb.window_start,
      COALESCE(fa.first_activity_day, wb.window_start)
    ) AS effective_start,
    wb.window_end AS effective_end
  FROM (SELECT DISTINCT user_id FROM active_tasks) at
  JOIN window_bounds wb ON wb.user_id = at.user_id
  LEFT JOIN first_activity fa ON fa.user_id = at.user_id
),
-- All possible eligible task instances (user, task, day) in the effective window
all_task_instances AS (
  SELECT
    at.user_id,
    at.task_id,
    wd.day_date AS instance_date
  FROM active_tasks at
  JOIN user_effective_window uew
    ON uew.user_id = at.user_id
  JOIN window_dates wd
    ON wd.user_id = at.user_id
    AND wd.day_date BETWEEN uew.effective_start AND uew.effective_end
),
rested_instances AS (
  SELECT
    user_id,
    task_id,
    rested_on::date AS rest_date
  FROM public.task_rests
),
completed_instances AS (
  SELECT
    user_id,
    task_id,
    completed_on::date AS completion_date
  FROM public.task_completions
),
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
  WHERE ri.user_id IS NULL
),
eligible_counts AS (
  SELECT
    user_id,
    COUNT(*) AS eligible_count
  FROM eligible_instances
  GROUP BY user_id
),
completed_counts AS (
  SELECT
    ei.user_id,
    COUNT(DISTINCT (ci.user_id, ci.task_id, ci.completion_date)) AS completed_count
  FROM eligible_instances ei
  JOIN completed_instances ci ON (
    ei.user_id = ci.user_id
    AND ei.task_id = ci.task_id
    AND ei.instance_date = ci.completion_date
  )
  GROUP BY ei.user_id
)
SELECT
  uew.user_id,
  wb.window_start,
  wb.window_end,
  COALESCE(ec.eligible_count, 0) AS eligible_instances,
  COALESCE(cc.completed_count, 0) AS completed_instances,
  CASE
    WHEN COALESCE(ec.eligible_count, 0) > 0
    THEN ROUND((COALESCE(cc.completed_count, 0)::numeric / ec.eligible_count::numeric) * 100, 0)
    ELSE 0
  END AS completion_pct
FROM user_effective_window uew
JOIN window_bounds wb ON wb.user_id = uew.user_id
LEFT JOIN eligible_counts ec ON ec.user_id = uew.user_id
LEFT JOIN completed_counts cc ON cc.user_id = uew.user_id;

COMMENT ON VIEW public.user_rolling_30d_consistency IS 
'Rolling last-30-days consistency per user. Uses calendar date boundaries (midnight rollover). Window end is capped at latest completion + 1 day to prevent premature inclusion of future dates due to timezone differences. New days are eligible even if user has not logged in yet (allows midnight missed task tracking). Eligibility = active tasks × days in window minus rests.';

ALTER VIEW public.user_rolling_30d_consistency SET (security_invoker = true);
