-- Migration: Fix cohort task created date and execution streaks
-- Problem 1: Cohort % is wrong because task_created_date uses UTC, excluding Dec 19 when tasks were created at 6pm CT
-- Problem 2: Current streak is wrong because it uses CURRENT_DATE (server timezone) and doesn't account for in-progress today
-- Solution: Use user-local dates for task creation cutoff and redefine streaks with timezone-safe logic

-- PART A: Fix cohort function to use task_created_local_date
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
      -- Use user-local created date instead of UTC date
      (t.created_at AT TIME ZONE mt.timezone)::date AS task_created_local_date
    FROM public.tasks t
    JOIN member_timezones mt ON mt.user_id = t.user_id
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
    -- Use task_created_local_date instead of task_created_date
    WHERE dspu.day_date >= COALESCE(at.task_created_local_date, udr.range_start)
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
'Returns month-to-date consistency for all members of a cohort. Uses each member''s timezone from profiles.timezone to compute their "today" (calendar day boundaries at local midnight) and task created dates. This ensures accurate rankings regardless of server timezone.';

-- PART B: Create timezone-safe execution streaks RPC function
-- This replaces the user_execution_streaks view with timezone-aware logic
-- First drop the existing function if it exists (to allow return type change)
-- Note: Must drop with exact parameter type, not parameter name
DROP FUNCTION IF EXISTS public.get_execution_streaks(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_execution_streaks(p_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  user_id uuid,
  current_streak_days integer,
  best_streak_days integer
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_timezone text;
  v_user_today date;
  v_anchor_day date;
BEGIN
  -- Get user ID (use parameter or current user)
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get user's timezone from profiles (defaults to UTC if not set)
  SELECT COALESCE(timezone, 'UTC') INTO v_timezone
  FROM public.profiles
  WHERE id = v_user_id;

  -- Compute user's "today" in their timezone
  v_user_today := (NOW() AT TIME ZONE v_timezone)::date;

  -- Return streak data using timezone-safe logic
  RETURN QUERY
  WITH active_tasks AS (
    SELECT t.id AS task_id, t.created_at
    FROM public.tasks t
    WHERE t.is_active = true
      AND t.user_id = v_user_id
  ),
  -- Get earliest activity date (in user's timezone)
  first_activity_date AS (
    SELECT LEAST(
      COALESCE((SELECT MIN(tc.completed_on)::date FROM public.task_completions tc WHERE tc.user_id = v_user_id), v_user_today),
      COALESCE((SELECT MIN(tr.rested_on)::date FROM public.task_rests tr WHERE tr.user_id = v_user_id), v_user_today),
      COALESCE((SELECT MIN((t.created_at AT TIME ZONE v_timezone)::date) FROM public.tasks t WHERE t.user_id = v_user_id AND t.is_active = true), v_user_today)
    ) AS earliest_date
  ),
  -- Get all dates from first activity to user_today
  date_range AS (
    SELECT generate_series(
      (SELECT earliest_date FROM first_activity_date),
      v_user_today,
      '1 day'::interval
    )::date AS day_date
  ),
  -- For each day, compute eligible instances (active tasks excluding rests)
  eligible_instances_per_day AS (
    SELECT
      dr.day_date,
      at.task_id
    FROM date_range dr
    CROSS JOIN active_tasks at
    WHERE dr.day_date >= (at.created_at AT TIME ZONE v_timezone)::date
      AND NOT EXISTS (
        SELECT 1
        FROM public.task_rests tr
        WHERE tr.user_id = v_user_id
          AND tr.task_id = at.task_id
          AND tr.rested_on::date = dr.day_date
      )
  ),
  -- Count eligible instances per day
  eligible_counts_per_day AS (
    SELECT
      eipd.day_date,
      COUNT(*) AS eligible_count
    FROM eligible_instances_per_day eipd
    GROUP BY eipd.day_date
  ),
  -- Count completed instances per day
  completed_counts_per_day AS (
    SELECT
      eipd.day_date,
      COUNT(DISTINCT tc.task_id) AS completed_count
    FROM eligible_instances_per_day eipd
    LEFT JOIN public.task_completions tc ON (
      tc.user_id = v_user_id
      AND tc.task_id = eipd.task_id
      AND tc.completed_on::date = eipd.day_date
    )
    GROUP BY eipd.day_date
  ),
  -- Determine successful days: completed == eligible AND eligible > 0
  successful_days AS (
    SELECT
      ecpd.day_date,
      CASE
        WHEN ecpd.eligible_count > 0
          AND COALESCE(ccpd.completed_count, 0) = ecpd.eligible_count
        THEN true
        ELSE false
      END AS is_successful
    FROM eligible_counts_per_day ecpd
    LEFT JOIN completed_counts_per_day ccpd ON ccpd.day_date = ecpd.day_date
  ),
  -- Determine anchor_day: user_today if successful, else user_today - 1
  anchor_day_calc AS (
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1 FROM successful_days sd
          WHERE sd.day_date = v_user_today
            AND sd.is_successful = true
        )
        THEN v_user_today
        ELSE v_user_today - 1
      END AS anchor_day
  ),
  -- Get only successful days up to anchor_day
  successful_days_up_to_anchor AS (
    SELECT sd.day_date
    FROM successful_days sd
    CROSS JOIN anchor_day_calc adc
    WHERE sd.is_successful = true
      AND sd.day_date <= adc.anchor_day
  ),
  -- Group consecutive successful days into streaks
  streak_groups AS (
    SELECT
      sdua.day_date,
      sdua.day_date - ROW_NUMBER() OVER (
        ORDER BY sdua.day_date
      )::integer AS streak_group
    FROM successful_days_up_to_anchor sdua
  ),
  -- Calculate streak lengths
  streak_lengths AS (
    SELECT
      streak_group,
      MIN(day_date) AS streak_start,
      MAX(day_date) AS streak_end,
      COUNT(*) AS streak_length
    FROM streak_groups
    GROUP BY streak_group
  ),
  -- Current streak: consecutive successful days ending at anchor_day
  current_streak AS (
    SELECT
      COALESCE(MAX(sl.streak_length), 0) AS current_streak_days
    FROM streak_lengths sl
    CROSS JOIN anchor_day_calc adc
    WHERE sl.streak_end = adc.anchor_day
  ),
  -- Best streak: calculate from ALL successful days (not just up to anchor)
  all_successful_days AS (
    SELECT sd.day_date
    FROM successful_days sd
    WHERE sd.is_successful = true
  ),
  all_streak_groups AS (
    SELECT
      asd.day_date,
      asd.day_date - ROW_NUMBER() OVER (
        ORDER BY asd.day_date
      )::integer AS streak_group
    FROM all_successful_days asd
  ),
  all_streak_lengths AS (
    SELECT
      streak_group,
      COUNT(*) AS streak_length
    FROM all_streak_groups
    GROUP BY streak_group
  ),
  best_streak AS (
    SELECT
      COALESCE(MAX(asl.streak_length), 0) AS best_streak_days
    FROM all_streak_lengths asl
  )
  SELECT
    v_user_id,
    cs.current_streak_days::integer,
    bs.best_streak_days::integer
  FROM current_streak cs
  CROSS JOIN best_streak bs;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_execution_streaks(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_execution_streaks(uuid) FROM public;

COMMENT ON FUNCTION public.get_execution_streaks(uuid) IS 
'Returns execution streaks for a user. Uses user''s timezone from profiles.timezone to compute "today" and day boundaries. A successful day requires all eligible tasks (excluding rests) to be completed. Current streak ends at anchor_day (user_today if successful today, else user_today - 1). Best streak is the maximum consecutive successful days in history.';

