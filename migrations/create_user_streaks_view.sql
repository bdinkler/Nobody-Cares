-- ============================================
-- Migration: Create user_execution_streaks view (OPTION 2)
-- - Current streak is consecutive executed days ending at yesterday
-- - Onboarding tasks count immediately on signup day
-- - Tasks added later begin tracking tomorrow
-- ============================================

-- PART A: Indexes
CREATE INDEX IF NOT EXISTS idx_task_completions_user_date 
ON public.task_completions(user_id, completed_on);

CREATE INDEX IF NOT EXISTS idx_task_rests_user_date 
ON public.task_rests(user_id, rested_on);

CREATE INDEX IF NOT EXISTS idx_tasks_user_active 
ON public.tasks(user_id, is_active);

-- PART B: View
DROP VIEW IF EXISTS public.user_execution_streaks;

CREATE VIEW public.user_execution_streaks AS
WITH yesterday AS (
  SELECT (CURRENT_DATE - INTERVAL '1 day')::date AS as_of_date
),
date_range AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '365 days')::date,
    (SELECT as_of_date FROM yesterday),
    '1 day'::interval
  )::date AS day_date
),
users_with_tasks AS (
  SELECT DISTINCT user_id
  FROM public.tasks
  WHERE is_active = true
),
active_tasks AS (
  SELECT 
    t.user_id,
    t.id AS task_id,
    t.created_at,
    p.created_at AS profile_created_at,
    CASE
      WHEN t.created_at IS NOT NULL
       AND p.created_at IS NOT NULL
       AND t.created_at::date = p.created_at::date
      THEN t.created_at::date
      WHEN t.created_at IS NOT NULL
      THEN (t.created_at::date + 1)
      ELSE CURRENT_DATE::date
    END AS tracking_start_date
  FROM public.tasks t
  LEFT JOIN public.profiles p ON p.id = t.user_id
  WHERE t.is_active = true
),
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
user_task_dates AS (
  SELECT 
    at.user_id,
    dr.day_date,
    at.task_id
  FROM active_tasks at
  CROSS JOIN date_range dr
  WHERE (
    -- Eligible only starting the tracking_start_date (option 2 rule)
    dr.day_date >= at.tracking_start_date
    OR EXISTS (
      -- Safety: if there was a completion that day, include it
      SELECT 1
      FROM tasks_with_completions twc
      WHERE twc.user_id = at.user_id
        AND twc.task_id = at.task_id
        AND twc.day_date = dr.day_date
    )
  )
),
rested_instances AS (
  SELECT 
    user_id,
    task_id,
    rested_on AS day_date
  FROM public.task_rests
  WHERE rested_on <= (SELECT as_of_date FROM yesterday)
),
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
  WHERE ri.user_id IS NULL
),
eligible_counts AS (
  SELECT 
    user_id,
    day_date,
    COUNT(*) AS eligible_count
  FROM eligible_instances
  GROUP BY user_id, day_date
),
all_completions AS (
  SELECT 
    user_id,
    task_id,
    completed_on AS day_date
  FROM public.task_completions
  WHERE completed_on <= (SELECT as_of_date FROM yesterday)
),
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
executed_days_only AS (
  SELECT 
    user_id,
    day_date
  FROM executed_days
  WHERE is_executed = true
),
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
current_streaks AS (
  SELECT 
    user_id,
    streak_length AS current_streak_days
  FROM streak_lengths
  WHERE streak_end = (SELECT as_of_date FROM yesterday)
),
best_streaks AS (
  SELECT 
    user_id,
    COALESCE(MAX(streak_length), 0) AS best_streak_days
  FROM streak_lengths
  GROUP BY user_id
)
SELECT 
  uwt.user_id,
  COALESCE(cs.current_streak_days, 0) AS current_streak_days,
  COALESCE(bs.best_streak_days, 0) AS best_streak_days,
  (SELECT as_of_date FROM yesterday) AS as_of_date
FROM users_with_tasks uwt
LEFT JOIN current_streaks cs ON cs.user_id = uwt.user_id
LEFT JOIN best_streaks bs ON bs.user_id = uwt.user_id;

COMMENT ON VIEW public.user_execution_streaks IS 
'User execution streaks. Current streak is consecutive executed days ending at yesterday. Onboarding tasks count immediately on signup day; tasks added later begin tracking tomorrow. Today excluded from streak evaluation.';

ALTER VIEW public.user_execution_streaks SET (security_invoker = true);
