-- Migration: Fix get_cohort_month_to_date_consistency RLS issue
-- Problem: Function uses SECURITY INVOKER, so RLS blocks reading other users' tasks/completions/rests
-- Solution: Convert to SECURITY DEFINER with authorization check
-- 
-- Security:
-- - Function runs with definer privileges (bypasses RLS)
-- - Hard authorization check: caller must be a member of the cohort
-- - Prevents arbitrary cohort_id scraping
--
-- Behavior:
-- - Returns ALL cohort members even if they have 0 eligible tasks (shows 0/0 -> 0%)
-- - Members with tasks and completions show correct percentages
-- - Uses timezone-aware date calculations per user

CREATE OR REPLACE FUNCTION public.get_cohort_month_to_date_consistency(p_cohort_id uuid)
RETURNS TABLE (
  user_id uuid,
  eligible_instances bigint,
  completed_instances bigint,
  completion_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_current_user_id uuid;
  v_month_start date;
  v_month_end date;
  v_is_member boolean;
BEGIN
  -- Get current user ID (must be authenticated)
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- HARD AUTHORIZATION CHECK: Verify caller is a member of this cohort
  -- This prevents arbitrary cohort_id scraping
  SELECT EXISTS(
    SELECT 1
    FROM public.cycle_cohort_members ccm
    WHERE ccm.cycle_cohort_id = p_cohort_id
      AND ccm.user_id = v_current_user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access denied: You are not a member of this cohort';
  END IF;

  -- Get current month boundaries (server timezone for month boundaries is OK)
  v_month_start := DATE_TRUNC('month', CURRENT_DATE)::date;
  v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;

  -- Return month-to-date consistency for all cohort members
  -- Each user's "today" is computed using their profiles.timezone
  -- SECURITY DEFINER allows reading tasks/completions/rests for all cohort members
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
  -- Return ALL cohort members, even those with 0 tasks (LEFT JOIN ensures this)
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
'Returns month-to-date consistency for all members of a cohort. Uses SECURITY DEFINER to bypass RLS and read tasks/completions/rests for all cohort members. Authorization: caller must be a member of the cohort (checked at function start). Uses each member''s timezone from profiles.timezone to compute their "today" (calendar day boundaries at local midnight) and task created dates. Returns ALL cohort members even if they have 0 eligible tasks (shows 0/0 -> 0%).';

-- ============================================
-- VERIFICATION QUERIES (for dev/testing)
-- ============================================
-- Run these after migration to verify the fix:
--
-- 1. Confirm function returns correct stats for both users in a cohort:
--    SELECT * FROM public.get_cohort_month_to_date_consistency('YOUR_COHORT_ID_HERE');
--    -- Should return rows for ALL cohort members, not just the caller
--
-- 2. Confirm tasks exist for both users with is_active = true:
--    SELECT user_id, COUNT(*) as task_count
--    FROM public.tasks
--    WHERE is_active = true
--      AND user_id IN (
--        SELECT user_id FROM public.cycle_cohort_members 
--        WHERE cycle_cohort_id = 'YOUR_COHORT_ID_HERE'
--      )
--    GROUP BY user_id;
--    -- Should show tasks for all cohort members
--
-- 3. Confirm task_completions rows exist for other user in current month:
--    SELECT user_id, COUNT(*) as completion_count
--    FROM public.task_completions
--    WHERE completed_on::date >= DATE_TRUNC('month', CURRENT_DATE)::date
--      AND completed_on::date <= (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
--      AND user_id IN (
--        SELECT user_id FROM public.cycle_cohort_members 
--        WHERE cycle_cohort_id = 'YOUR_COHORT_ID_HERE'
--      )
--    GROUP BY user_id;
--    -- Should show completions for all cohort members who have them
--
-- 4. Test authorization: Try calling with a cohort_id you're NOT a member of:
--    SELECT * FROM public.get_cohort_month_to_date_consistency('SOME_OTHER_COHORT_ID');
--    -- Should raise exception: "Access denied: You are not a member of this cohort"

