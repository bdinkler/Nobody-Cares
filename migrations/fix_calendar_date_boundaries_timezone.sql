-- Migration: Fix calendar date boundaries using user timezone (Option B)
-- Problem: Views use CURRENT_DATE (server timezone) which can be ahead of user's local time
-- Solution: Use RPC function that computes user's "today" based on profiles.timezone
-- This ensures calendar day boundaries align with user's local midnight

-- PART A: Change timezone default to UTC (do not overwrite existing values)
ALTER TABLE public.profiles 
ALTER COLUMN timezone SET DEFAULT 'UTC';

-- PART B: Drop the existing view (it uses CURRENT_DATE which is unsafe)
DROP VIEW IF EXISTS public.user_rolling_30d_consistency;

-- PART C: Create RPC function that uses user's timezone to compute "today"
CREATE OR REPLACE FUNCTION public.get_my_rolling_30d_consistency()
RETURNS TABLE (
  user_id uuid,
  window_start date,
  window_end date,
  eligible_instances bigint,
  completed_instances bigint,
  completion_pct numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_timezone text;
  v_user_today date;
  v_window_start date;
  v_window_end date;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get user's timezone from profiles (defaults to UTC if not set)
  SELECT COALESCE(timezone, 'UTC') INTO v_timezone
  FROM public.profiles
  WHERE id = v_user_id;

  -- Compute user's "today" in their timezone
  -- user_today := (now() at time zone profiles.timezone)::date
  v_user_today := (NOW() AT TIME ZONE v_timezone)::date;
  
  -- Calculate window: last 30 days including today
  v_window_start := (v_user_today - INTERVAL '29 days')::date;
  v_window_end := v_user_today;

  -- Return the consistency data using the user's timezone-based dates
  RETURN QUERY
  WITH window_dates AS (
    SELECT generate_series(
      v_window_start,
      v_window_end,
      '1 day'::interval
    )::date AS day_date
  ),
  active_tasks AS (
    SELECT t.user_id, t.id AS task_id
    FROM public.tasks t
    WHERE t.is_active = true
      AND t.user_id = v_user_id
  ),
  -- First activity day for fairness
  first_activity AS (
    SELECT
      MIN(u.first_day)::date AS first_activity_day
    FROM (
      SELECT MIN(tc.completed_on)::date AS first_day
      FROM public.task_completions tc
      WHERE tc.user_id = v_user_id

      UNION ALL

      SELECT MIN(tr.rested_on)::date AS first_day
      FROM public.task_rests tr
      WHERE tr.user_id = v_user_id

      UNION ALL

      SELECT MIN(t.created_at)::date AS first_day
      FROM public.tasks t
      WHERE t.user_id = v_user_id
        AND t.created_at IS NOT NULL
    ) u
  ),
  user_effective_window AS (
    SELECT
      GREATEST(
        v_window_start,
        COALESCE((SELECT first_activity_day FROM first_activity), v_window_start)
      ) AS effective_start,
      v_window_end AS effective_end
  ),
  -- All possible eligible task instances (user, task, day) in the effective window
  all_task_instances AS (
    SELECT
      at.task_id,
      wd.day_date AS instance_date
    FROM active_tasks at
    CROSS JOIN user_effective_window uew
    CROSS JOIN window_dates wd
    WHERE wd.day_date BETWEEN uew.effective_start AND uew.effective_end
  ),
  rested_instances AS (
    SELECT
      tr.task_id,
      tr.rested_on::date AS rest_date
    FROM public.task_rests tr
    WHERE tr.user_id = v_user_id
      AND tr.rested_on::date BETWEEN v_window_start AND v_window_end
  ),
  completed_instances AS (
    SELECT
      tc.task_id,
      tc.completed_on::date AS completion_date
    FROM public.task_completions tc
    WHERE tc.user_id = v_user_id
      AND tc.completed_on::date BETWEEN v_window_start AND v_window_end
  ),
  eligible_instances AS (
    SELECT
      ati.task_id,
      ati.instance_date
    FROM all_task_instances ati
    LEFT JOIN rested_instances ri ON (
      ati.task_id = ri.task_id
      AND ati.instance_date = ri.rest_date
    )
    WHERE ri.task_id IS NULL
  ),
  eligible_counts AS (
    SELECT
      COUNT(*) AS eligible_count
    FROM eligible_instances
  ),
  completed_counts AS (
    SELECT
      COUNT(DISTINCT (ci.task_id, ci.completion_date)) AS completed_count
    FROM eligible_instances ei
    JOIN completed_instances ci ON (
      ei.task_id = ci.task_id
      AND ei.instance_date = ci.completion_date
    )
  ),
  final_counts AS (
    SELECT
      COALESCE((SELECT eligible_count FROM eligible_counts), 0) AS eligible_count,
      COALESCE((SELECT completed_count FROM completed_counts), 0) AS completed_count
  )
  SELECT
    v_user_id,
    v_window_start,
    v_window_end,
    fc.eligible_count::bigint,
    fc.completed_count::bigint,
    CASE
      WHEN fc.eligible_count > 0
      THEN ROUND((fc.completed_count::numeric / fc.eligible_count::numeric) * 100, 0)
      ELSE 0
    END
  FROM final_counts fc;
END;
$$;

-- PART D: Grant execute permission to authenticated users, revoke from public
GRANT EXECUTE ON FUNCTION public.get_my_rolling_30d_consistency() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_rolling_30d_consistency() FROM public;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_my_rolling_30d_consistency() IS 
'Returns rolling last-30-days consistency for the current authenticated user. Uses user''s timezone from profiles.timezone to compute "today" (calendar day boundaries at local midnight). This prevents premature day rollover due to server timezone differences. Eligibility = active tasks × days in window minus rests.';

-- PART E: Create RPC function for cohort month-to-date consistency (timezone-safe)
-- This replaces the user_month_to_date_consistency view for cohort rankings
CREATE OR REPLACE FUNCTION public.get_cohort_month_to_date_consistency(p_cohort_id uuid)
RETURNS TABLE (
  user_id uuid,
  eligible_instances bigint,
  completed_instances bigint,
  completion_pct numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_current_user_id uuid;
  v_month_start date;
  v_month_end date;
BEGIN
  -- Get current user ID (must be authenticated)
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get current month boundaries (server timezone for month boundaries is OK)
  v_month_start := DATE_TRUNC('month', CURRENT_DATE)::date;
  v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;

  -- Return month-to-date consistency for all cohort members
  -- Each user's "today" is computed using their profiles.timezone
  RETURN QUERY
  WITH cohort_members AS (
    SELECT ccm.user_id
    FROM public.cycle_cohort_members ccm
    WHERE ccm.cycle_cohort_id = p_cohort_id
  ),
  member_timezones AS (
    SELECT
      cm.user_id,
      COALESCE(p.timezone, 'UTC') AS timezone
    FROM cohort_members cm
    LEFT JOIN public.profiles p ON p.id = cm.user_id
  ),
  member_today AS (
    SELECT
      mt.user_id,
      (NOW() AT TIME ZONE mt.timezone)::date AS user_today,
      GREATEST(
        v_month_start,
        (NOW() AT TIME ZONE mt.timezone)::date
      ) AS effective_end
    FROM member_timezones mt
  ),
  active_tasks_per_user AS (
    SELECT
      t.user_id,
      t.id AS task_id,
      t.created_at::date AS task_created_date
    FROM public.tasks t
    WHERE t.is_active = true
      AND t.user_id IN (SELECT cm.user_id FROM cohort_members cm)
  ),
  user_date_ranges AS (
    SELECT
      mt.user_id,
      mt.user_today,
      mt.effective_end,
      v_month_start AS range_start,
      LEAST(mt.effective_end, v_month_end) AS range_end
    FROM member_today mt
  ),
  date_series_per_user AS (
    SELECT
      udr.user_id AS ds_user_id,
      generate_series(
        udr.range_start,
        udr.range_end,
        '1 day'::interval
      )::date AS day_date
    FROM user_date_ranges udr
  ),
  user_task_instances AS (
    SELECT
      at.user_id,
      at.task_id,
      dspu.day_date AS instance_date
    FROM active_tasks_per_user at
    JOIN user_date_ranges udr ON udr.user_id = at.user_id
    JOIN date_series_per_user dspu ON dspu.ds_user_id = at.user_id
    WHERE dspu.day_date >= COALESCE(at.task_created_date, udr.range_start)
  ),
  rested_instances AS (
    SELECT
      tr.user_id,
      tr.task_id,
      tr.rested_on::date AS rest_date
    FROM public.task_rests tr
    JOIN user_date_ranges udr ON udr.user_id = tr.user_id
    WHERE tr.rested_on::date BETWEEN udr.range_start AND udr.range_end
  ),
  completed_instances AS (
    SELECT
      tc.user_id,
      tc.task_id,
      tc.completed_on::date AS completion_date
    FROM public.task_completions tc
    JOIN user_date_ranges udr ON udr.user_id = tc.user_id
    WHERE tc.completed_on::date BETWEEN udr.range_start AND udr.range_end
  ),
  eligible_instances AS (
    SELECT
      uti.user_id,
      uti.task_id,
      uti.instance_date
    FROM user_task_instances uti
    LEFT JOIN rested_instances ri ON (
      uti.user_id = ri.user_id
      AND uti.task_id = ri.task_id
      AND uti.instance_date = ri.rest_date
    )
    WHERE ri.user_id IS NULL
  ),
  eligible_counts AS (
    SELECT
      ei.user_id,
      COUNT(*) AS eligible_count
    FROM eligible_instances ei
    GROUP BY ei.user_id
  ),
  completed_counts AS (
    SELECT
      ei.user_id,
      COUNT(DISTINCT (ci.task_id, ci.completion_date)) AS completed_count
    FROM eligible_instances ei
    JOIN completed_instances ci ON (
      ei.user_id = ci.user_id
      AND ei.task_id = ci.task_id
      AND ei.instance_date = ci.completion_date
    )
    GROUP BY ei.user_id
  )
  SELECT
    cm.user_id,
    COALESCE(ec.eligible_count, 0)::bigint,
    COALESCE(cc.completed_count, 0)::bigint,
    CASE
      WHEN COALESCE(ec.eligible_count, 0) > 0
      THEN ROUND((COALESCE(cc.completed_count, 0)::numeric / ec.eligible_count::numeric) * 100, 0)
      ELSE 0
    END
  FROM cohort_members cm
  LEFT JOIN eligible_counts ec ON ec.user_id = cm.user_id
  LEFT JOIN completed_counts cc ON cc.user_id = cm.user_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_cohort_month_to_date_consistency(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cohort_month_to_date_consistency(uuid) FROM public;

COMMENT ON FUNCTION public.get_cohort_month_to_date_consistency(uuid) IS 
'Returns month-to-date consistency for all members of a cohort. Uses each member''s timezone from profiles.timezone to compute their "today" (calendar day boundaries at local midnight). This ensures accurate rankings regardless of server timezone.';

