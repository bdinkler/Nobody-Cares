-- ============================================
-- Migration: Fix cohort month-to-date consistency calculation
-- - Creates canonical view for month-to-date consistency
-- - Fixes ensure_monthly_cycle_and_assign_user RPC
-- - Ensures proper month boundary handling
-- ============================================

-- PART A: Create canonical month-to-date consistency view
DROP VIEW IF EXISTS public.user_month_to_date_consistency;

CREATE VIEW public.user_month_to_date_consistency AS
WITH month_boundaries AS (
  SELECT 
    DATE_TRUNC('month', CURRENT_DATE)::date AS month_start,
    (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date AS month_end,
    CURRENT_DATE::date AS today
),
-- Effective end date: today or month_end, whichever is earlier (for live updates)
effective_range AS (
  SELECT 
    month_start,
    LEAST(today, month_end) AS effective_end
  FROM month_boundaries
),
-- Active tasks per user
active_tasks AS (
  SELECT 
    user_id,
    id AS task_id,
    created_at::date AS task_created_date
  FROM public.tasks
  WHERE is_active = true
),
-- Find earliest completion date per user (within current month)
earliest_completions AS (
  SELECT
    user_id,
    MIN(completed_on::date) AS earliest_completion_date
  FROM public.task_completions
  WHERE completed_on::date >= (SELECT month_start FROM effective_range)
    AND completed_on::date <= (SELECT effective_end FROM effective_range)
  GROUP BY user_id
),
-- Find earliest rest date per user (within current month)
earliest_rests AS (
  SELECT
    user_id,
    MIN(rested_on::date) AS earliest_rest_date
  FROM public.task_rests
  WHERE rested_on::date >= (SELECT month_start FROM effective_range)
    AND rested_on::date <= (SELECT effective_end FROM effective_range)
  GROUP BY user_id
),
-- Find earliest task created_at per user
earliest_task_created AS (
  SELECT
    user_id,
    MIN(task_created_date) AS earliest_task_date
  FROM active_tasks
  GROUP BY user_id
),
-- Compute effective start per user: GREATEST(month_start, LEAST(earliest_task_created, earliest_completion, earliest_rest))
-- Get all unique user_ids from the three sources (users with active tasks)
all_users AS (
  SELECT DISTINCT user_id FROM active_tasks
),
-- Combine earliest dates per user
user_earliest_dates AS (
  SELECT
    au.user_id,
    etc.earliest_task_date,
    ec.earliest_completion_date,
    er.earliest_rest_date
  FROM all_users au
  LEFT JOIN earliest_task_created etc ON au.user_id = etc.user_id
  LEFT JOIN earliest_completions ec ON au.user_id = ec.user_id
  LEFT JOIN earliest_rests er ON au.user_id = er.user_id
),
-- Compute effective start: GREATEST(month_start, LEAST(...)) where NULLs in LEAST are treated as ignored (use sentinel date)
-- If all are NULL, effective_start = month_start
user_effective_starts AS (
  SELECT
    ued.user_id,
    CASE
      WHEN ued.earliest_task_date IS NULL 
       AND ued.earliest_completion_date IS NULL 
       AND ued.earliest_rest_date IS NULL
      THEN (SELECT month_start FROM effective_range)
      ELSE GREATEST(
        (SELECT month_start FROM effective_range),
        LEAST(
          COALESCE(ued.earliest_task_date, '9999-12-31'::date),
          COALESCE(ued.earliest_completion_date, '9999-12-31'::date),
          COALESCE(ued.earliest_rest_date, '9999-12-31'::date)
        )
      )
    END AS effective_start
  FROM user_earliest_dates ued
),
-- Generate date range per user (from their effective_start to effective_end)
user_date_ranges AS (
  SELECT
    ues.user_id,
    generate_series(
      ues.effective_start,
      (SELECT effective_end FROM effective_range),
      '1 day'::interval
    )::date AS day_date
  FROM user_effective_starts ues
),
-- Get all completions in the month-to-date range (for proof-of-existence)
completions_in_range AS (
  SELECT
    user_id,
    task_id,
    completed_on::date AS completion_date
  FROM public.task_completions
  WHERE completed_on::date >= (SELECT month_start FROM effective_range)
    AND completed_on::date <= (SELECT effective_end FROM effective_range)
),
-- All eligible task instances: (user, task, day) where:
-- 1. Day is in user's effective date range
-- 2. Task is active
-- 3. Task was created by or before that day OR there's a completion for that task on that day (proof it existed)
eligible_task_instances AS (
  SELECT
    udr.user_id,
    at.task_id,
    udr.day_date
  FROM user_date_ranges udr
  INNER JOIN active_tasks at ON at.user_id = udr.user_id
  WHERE at.task_created_date IS NULL 
     OR at.task_created_date <= udr.day_date
     OR EXISTS (
       SELECT 1 FROM completions_in_range cir
       WHERE cir.user_id = udr.user_id
         AND cir.task_id = at.task_id
         AND cir.completion_date = udr.day_date
     )
),
-- Rested instances in the month-to-date range
rested_instances AS (
  SELECT
    user_id,
    task_id,
    rested_on::date AS rest_date
  FROM public.task_rests
  WHERE rested_on::date >= (SELECT month_start FROM effective_range)
    AND rested_on::date <= (SELECT effective_end FROM effective_range)
),
-- Eligible instances = eligible_task_instances minus rested_instances
eligible_instances AS (
  SELECT
    eti.user_id,
    eti.task_id,
    eti.day_date
  FROM eligible_task_instances eti
  LEFT JOIN rested_instances ri ON (
    eti.user_id = ri.user_id
    AND eti.task_id = ri.task_id
    AND eti.day_date = ri.rest_date
  )
  WHERE ri.user_id IS NULL
),
-- Match completions to eligible instances
matched_completions AS (
  SELECT
    ei.user_id,
    ei.task_id,
    ei.day_date
  FROM eligible_instances ei
  INNER JOIN completions_in_range cir ON (
    ei.user_id = cir.user_id
    AND ei.task_id = cir.task_id
    AND ei.day_date = cir.completion_date
  )
),
-- Count eligible instances per user
eligible_counts AS (
  SELECT
    user_id,
    COUNT(*) AS eligible_count
  FROM eligible_instances
  GROUP BY user_id
),
-- Count matched completions per user
completed_counts AS (
  SELECT
    user_id,
    COUNT(*) AS completed_count
  FROM matched_completions
  GROUP BY user_id
),
-- Get all users with active tasks (base set - users who should appear in view)
users_with_tasks AS (
  SELECT DISTINCT user_id
  FROM active_tasks
),
-- Combine counts for all users with tasks
user_counts AS (
  SELECT
    uwt.user_id,
    COALESCE(ec.eligible_count, 0) AS eligible_count,
    COALESCE(cc.completed_count, 0) AS completed_count
  FROM users_with_tasks uwt
  LEFT JOIN eligible_counts ec ON uwt.user_id = ec.user_id
  LEFT JOIN completed_counts cc ON uwt.user_id = cc.user_id
)
SELECT
  uc.user_id,
  ues.effective_start AS window_start,
  (SELECT effective_end FROM effective_range) AS window_end,
  uc.eligible_count AS eligible_instances,
  uc.completed_count AS completed_instances,
  CASE
    WHEN uc.eligible_count > 0
    THEN ROUND((uc.completed_count::numeric / uc.eligible_count::numeric) * 100, 0)::integer
    ELSE 0
  END AS completion_pct
FROM user_counts uc
INNER JOIN user_effective_starts ues ON uc.user_id = ues.user_id;

COMMENT ON VIEW public.user_month_to_date_consistency IS
'Month-to-date consistency per user for the current calendar month. Window starts from GREATEST(month_start, LEAST(earliest_task_created, earliest_completion, earliest_rest)) through today (or month_end, whichever is earlier) for live updates. Tasks are eligible if created_by <= day OR completion exists on that day (proof of existence). Eligibility = active tasks × days in range minus rests. Completion percentage is 0-100.';

ALTER VIEW public.user_month_to_date_consistency SET (security_invoker = true);

-- PART B: Fix ensure_monthly_cycle_and_assign_user RPC
DROP FUNCTION IF EXISTS public.ensure_monthly_cycle_and_assign_user();
DROP FUNCTION IF EXISTS public.ensure_monthly_cycle_and_assign_user(text);

CREATE OR REPLACE FUNCTION public.ensure_monthly_cycle_and_assign_user()
RETURNS TABLE(
  cycle_id uuid,
  cycle_cohort_id uuid,
  cohort_number integer,
  member_count bigint,
  resets_on date,
  month_start date,
  month_end date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_category goal_category := 'general'::goal_category;

  v_month_start date;
  v_month_end date;
  v_resets_on date;

  v_cycle_id uuid;
  v_cohort_id uuid;
  v_cohort_number integer;
  v_member_count bigint;

  v_max_members integer := 25;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Month boundaries
  v_month_start := date_trunc('month', current_date)::date;
  v_month_end   := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_resets_on   := (date_trunc('month', current_date) + interval '1 month')::date;

  -- Find existing cycle for this month (category is always general)
  SELECT cc.id
    INTO v_cycle_id
  FROM public.cohort_cycles cc
  WHERE cc.category = v_category
    AND cc.cycle_month = v_month_start
    AND cc.start_date = v_month_start
    AND cc.end_date = v_month_end
  LIMIT 1;

  -- Create if missing
  IF v_cycle_id IS NULL THEN
    INSERT INTO public.cohort_cycles (category, cycle_month, start_date, end_date, created_at)
    VALUES (v_category, v_month_start, v_month_start, v_month_end, now())
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_cycle_id;
    
    -- If INSERT didn't return (conflict), fetch it
    IF v_cycle_id IS NULL THEN
      SELECT cc.id
        INTO v_cycle_id
      FROM public.cohort_cycles cc
      WHERE cc.category = v_category
        AND cc.cycle_month = v_month_start
        AND cc.start_date = v_month_start
        AND cc.end_date = v_month_end
      LIMIT 1;
    END IF;
  END IF;

  -- If already assigned in this cycle, return their cohort
  SELECT ccm.cycle_cohort_id
    INTO v_cohort_id
  FROM public.cycle_cohort_members ccm
  JOIN public.cycle_cohorts coh ON coh.id = ccm.cycle_cohort_id
  WHERE ccm.user_id = v_user_id
    AND coh.cycle_id = v_cycle_id
  LIMIT 1;

  IF v_cohort_id IS NOT NULL THEN
    SELECT coh.cohort_number, COUNT(m.user_id)
      INTO v_cohort_number, v_member_count
    FROM public.cycle_cohorts coh
    LEFT JOIN public.cycle_cohort_members m ON m.cycle_cohort_id = coh.id
    WHERE coh.id = v_cohort_id
    GROUP BY coh.id, coh.cohort_number;

    RETURN QUERY SELECT
      v_cycle_id,
      v_cohort_id,
      v_cohort_number,
      v_member_count,
      v_resets_on,
      v_month_start,
      v_month_end;
    RETURN;
  END IF;

  -- Find a cohort with room (< 25). Prefer fuller cohorts to pack them.
  SELECT coh.id, coh.cohort_number, COUNT(m.user_id)
    INTO v_cohort_id, v_cohort_number, v_member_count
  FROM public.cycle_cohorts coh
  LEFT JOIN public.cycle_cohort_members m ON m.cycle_cohort_id = coh.id
  WHERE coh.cycle_id = v_cycle_id
  GROUP BY coh.id, coh.cohort_number
  HAVING COUNT(m.user_id) < v_max_members
  ORDER BY COUNT(m.user_id) DESC, coh.cohort_number ASC
  LIMIT 1;

  -- If none exist, create cohort #1 / next #
  IF v_cohort_id IS NULL THEN
    SELECT COALESCE(MAX(coh.cohort_number), 0) + 1
      INTO v_cohort_number
    FROM public.cycle_cohorts coh
    WHERE coh.cycle_id = v_cycle_id;

    INSERT INTO public.cycle_cohorts (cycle_id, cohort_number, category, created_at)
    VALUES (v_cycle_id, v_cohort_number, v_category, now())
    RETURNING id INTO v_cohort_id;

    v_member_count := 0;
  END IF;

  -- Assign user
  INSERT INTO public.cycle_cohort_members (cycle_cohort_id, user_id, joined_at)
  VALUES (v_cohort_id, v_user_id, now())
  ON CONFLICT DO NOTHING;

  -- Recount
  SELECT COUNT(*)
    INTO v_member_count
  FROM public.cycle_cohort_members m
  WHERE m.cycle_cohort_id = v_cohort_id;

  RETURN QUERY SELECT
    v_cycle_id,
    v_cohort_id,
    v_cohort_number,
    v_member_count,
    v_resets_on,
    v_month_start,
    v_month_end;
END;
$$;

-- Make sure authenticated users can call it
GRANT EXECUTE ON FUNCTION public.ensure_monthly_cycle_and_assign_user() TO authenticated;

COMMENT ON FUNCTION public.ensure_monthly_cycle_and_assign_user() IS
'Ensures a monthly cycle exists for the current month and assigns the current user to a cohort. Finds or creates an open cohort (capacity up to 25). Returns cohort metadata including cycle_id, cycle_cohort_id, cohort_number, member_count, and resets_on date. Idempotent: if user is already assigned, returns existing cohort data. Category is fixed to ''general'' - all users can be in any cohort.';

-- PART C: Indexes (if not already present)
CREATE INDEX IF NOT EXISTS idx_task_completions_user_date 
ON public.task_completions(user_id, completed_on);

CREATE INDEX IF NOT EXISTS idx_task_rests_user_date 
ON public.task_rests(user_id, rested_on);

CREATE INDEX IF NOT EXISTS idx_tasks_user_active 
ON public.tasks(user_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_cycle_cohort_members_cohort 
ON public.cycle_cohort_members(cycle_cohort_id);

