-- Migration: Fix rest_task_today to use user's local timezone for rested_on
-- Problem: rest_task_today uses CURRENT_DATE (server UTC) which can be ahead of user's local date
-- Solution: Use user's timezone from profiles.timezone to compute local "today"
-- Also ensures unique constraint exists to prevent duplicate rests

-- PART A: Ensure unique constraint exists (already in add_rest_limit_per_month_to_tasks.sql, but ensure it's there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'task_rests_user_task_date_unique'
  ) THEN
    ALTER TABLE public.task_rests
    ADD CONSTRAINT task_rests_user_task_date_unique 
    UNIQUE (user_id, task_id, rested_on);
  END IF;
END $$;

-- PART B: Update rest_task_today to use user's local timezone
DROP FUNCTION IF EXISTS public.rest_task_today(uuid);
DROP FUNCTION IF EXISTS public.rest_task_today(p_task_id uuid);

CREATE OR REPLACE FUNCTION public.rest_task_today(p_task_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_rest_limit integer;
  v_used_count integer;
  v_remaining integer;
  v_timezone text;
  v_user_today date;
  v_month_start date;
  v_month_end date;
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

  -- Compute user's "today" in their timezone (not server CURRENT_DATE)
  v_user_today := (NOW() AT TIME ZONE v_timezone)::date;
  
  -- Calculate month boundaries using user's local date
  v_month_start := date_trunc('month', v_user_today)::date;
  v_month_end := (date_trunc('month', v_user_today) + interval '1 month')::date;

  -- Fetch the task and its rest limit
  SELECT t.rest_limit_per_month INTO v_rest_limit
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.user_id = v_user_id;

  -- Check if task exists and belongs to user
  IF v_rest_limit IS NULL THEN
    RAISE EXCEPTION 'Task not found or does not belong to user';
  END IF;

  -- Check if rest is available for this task
  IF v_rest_limit <= 0 THEN
    RAISE EXCEPTION 'Rest not available for this task.';
  END IF;

  -- Count rests used for this user/task within current month (using user's local month boundaries)
  SELECT COUNT(*) INTO v_used_count
  FROM public.task_rests tr
  WHERE tr.user_id = v_user_id
    AND tr.task_id = p_task_id
    AND tr.rested_on >= v_month_start
    AND tr.rested_on < v_month_end;

  -- Calculate remaining before this rest
  v_remaining := GREATEST(0, v_rest_limit - v_used_count);

  -- Check if limit is already reached
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'No rest credits remaining for this task this month.';
  END IF;

  -- Insert the rest using user's local date (unique constraint will prevent duplicate rests for same day)
  INSERT INTO public.task_rests (user_id, task_id, rested_on)
  VALUES (v_user_id, p_task_id, v_user_today);

  -- Calculate remaining after this rest
  v_remaining := GREATEST(0, v_rest_limit - (v_used_count + 1));

  -- Return JSON with ok status and remaining
  RETURN json_build_object(
    'ok', true,
    'remaining', v_remaining
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Task already rested today.';
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.rest_task_today(p_task_id uuid) TO authenticated;

COMMENT ON FUNCTION public.rest_task_today(p_task_id uuid) IS 
'Enforces per-task monthly rest limits and inserts a rest for today using user''s local timezone from profiles.timezone. Returns ok and remaining credits.';

-- PART C: Update get_task_rest_credits to also use user's timezone for consistency
DROP FUNCTION IF EXISTS public.get_task_rest_credits(uuid);
DROP FUNCTION IF EXISTS public.get_task_rest_credits(p_task_id uuid);

CREATE OR REPLACE FUNCTION public.get_task_rest_credits(p_task_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_rest_limit integer;
  v_used_count integer;
  v_remaining integer;
  v_timezone text;
  v_user_today date;
  v_month_start date;
  v_month_end date;
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
  v_user_today := (NOW() AT TIME ZONE v_timezone)::date;
  
  -- Calculate month boundaries using user's local date
  v_month_start := date_trunc('month', v_user_today)::date;
  v_month_end := (date_trunc('month', v_user_today) + interval '1 month')::date;

  -- Fetch the task and its rest limit
  SELECT t.rest_limit_per_month INTO v_rest_limit
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.user_id = v_user_id;

  -- Check if task exists and belongs to user
  -- Default to 0 if task not found (task might not have rest enabled)
  IF v_rest_limit IS NULL THEN
    v_rest_limit := 0;
  END IF;

  -- Count rests used for this user/task within current month (using user's local month boundaries)
  SELECT COUNT(*) INTO v_used_count
  FROM public.task_rests tr
  WHERE tr.user_id = v_user_id
    AND tr.task_id = p_task_id
    AND tr.rested_on >= v_month_start
    AND tr.rested_on < v_month_end;

  -- Calculate remaining
  v_remaining := GREATEST(0, v_rest_limit - v_used_count);

  -- Return JSON with limit, used, and remaining
  RETURN json_build_object(
    'limit', v_rest_limit,
    'used', v_used_count,
    'remaining', v_remaining
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_task_rest_credits(p_task_id uuid) TO authenticated;

COMMENT ON FUNCTION public.get_task_rest_credits(p_task_id uuid) IS 
'Returns rest credits info (limit, used, remaining) for a task in the current month using user''s local timezone from profiles.timezone. Does not modify data.';

