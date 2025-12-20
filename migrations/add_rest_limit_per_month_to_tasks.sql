-- Migration: Add rest_credits_per_month column to tasks table
-- Run this in your Supabase SQL Editor
--
-- This migration:
-- 1. Adds rest_credits_per_month column to tasks table
-- 2. Sets default limits for Workout (4/month) and Deep Work (8/month)
-- 3. Adds index to task_rests for efficient monthly lookups
-- 4. Creates RPC function rest_task_today to enforce limits server-side
-- 5. Creates RPC function get_task_rest_credits to fetch remaining credits
--
-- Post-migration checklist:
-- [ ] Run migrations in Supabase
-- [ ] Test rest with Workout (4/month) and Deep Work (8/month)
-- [ ] Confirm modal shows remaining credits
-- [ ] Attempt 5th rest for Workout in same month is blocked

-- Step 1: Add rest_credits_per_month column to tasks table
-- If the old column rest_limit_per_month exists, migrate data and drop it
DO $$
BEGIN
  -- Check if old column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'rest_limit_per_month'
  ) THEN
    -- Add new column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'tasks' 
      AND column_name = 'rest_credits_per_month'
    ) THEN
      ALTER TABLE public.tasks ADD COLUMN rest_credits_per_month INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- Migrate data from old column to new column
    UPDATE public.tasks
    SET rest_credits_per_month = rest_limit_per_month
    WHERE rest_credits_per_month = 0 AND rest_limit_per_month > 0;
    
    -- Drop old column
    ALTER TABLE public.tasks DROP COLUMN IF EXISTS rest_limit_per_month;
  ELSE
    -- Old column doesn't exist, just add new column
    ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS rest_credits_per_month INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN public.tasks.rest_credits_per_month IS 'Maximum number of rest credits allowed per month for this task. 0 means rest is not available.';

-- Step 2: Set default limits for existing tasks based on title (using ILIKE for pattern matching)
-- Workout: 4 rest credits per month
UPDATE public.tasks
SET rest_credits_per_month = 4
WHERE title ILIKE 'workout%' AND rest_credits_per_month = 0;

-- Deep Work: 8 rest credits per month
UPDATE public.tasks
SET rest_credits_per_month = 8
WHERE title ILIKE 'deep work%' AND rest_credits_per_month = 0;

-- Step 3: Add index to task_rests for efficient monthly lookups
-- This index supports queries filtering by user_id, task_id, and date range
CREATE INDEX IF NOT EXISTS idx_task_rests_user_task_date 
ON public.task_rests(user_id, task_id, rested_on);

-- Step 4: Create RPC function to enforce per-task monthly rest limits
-- Drop existing function first if it exists (required when changing parameter names)
DROP FUNCTION IF EXISTS public.rest_task_today(uuid);

-- This function is SECURITY INVOKER (runs with caller's permissions) and enforces limits transactionally
CREATE OR REPLACE FUNCTION public.rest_task_today(p_task_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid;
  v_rest_limit integer;
  v_used_count integer;
  v_remaining_before integer;
  v_remaining_after integer;
  v_today date;
  v_month_start date;
  v_month_end date;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get today's date (server date)
  v_today := CURRENT_DATE;
  
  -- Calculate month boundaries
  v_month_start := date_trunc('month', v_today)::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month')::date;

  -- Fetch the task and its rest limit (using qualified column names)
  SELECT t.rest_credits_per_month INTO v_rest_limit
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

  -- Count rests used for this user/task within current month (using qualified column names)
  SELECT COUNT(*) INTO v_used_count
  FROM public.task_rests tr
  WHERE tr.user_id = v_user_id
    AND tr.task_id = p_task_id
    AND tr.rested_on >= v_month_start
    AND tr.rested_on < v_month_end;

  -- Calculate remaining before this rest
  v_remaining_before := GREATEST(0, v_rest_limit - v_used_count);

  -- Check if limit is already reached
  IF v_used_count >= v_rest_limit THEN
    RAISE EXCEPTION 'No rest credits remaining for this task this month.';
  END IF;

  -- Check if task is already rested today (using qualified column names)
  IF EXISTS (
    SELECT 1 FROM public.task_rests tr
    WHERE tr.user_id = v_user_id
      AND tr.task_id = p_task_id
      AND tr.rested_on = v_today
  ) THEN
    RAISE EXCEPTION 'Task already rested today.';
  END IF;

  -- Insert the rest
  INSERT INTO public.task_rests (user_id, task_id, rested_on)
  VALUES (v_user_id, p_task_id, v_today);

  -- If we get here, insert succeeded
  -- Calculate remaining after this rest
  v_remaining_after := GREATEST(0, v_rest_limit - (v_used_count + 1));

  -- Return JSON with limit and remaining info
  RETURN json_build_object(
    'limit', v_rest_limit,
    'used_before', v_used_count,
    'remaining_before', v_remaining_before,
    'remaining_after', v_remaining_after
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.rest_task_today(uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.rest_task_today(uuid) IS 'Enforces per-task monthly rest limits and inserts a rest for today. Returns limit and remaining credits info.';

-- Step 5: Create function to get rest credits info for a task (without inserting)
-- Drop existing function first if it exists (required when changing parameter names)
DROP FUNCTION IF EXISTS public.get_task_rest_credits(uuid);

-- This is used by the UI to display remaining credits before user confirms rest
CREATE OR REPLACE FUNCTION public.get_task_rest_credits(p_task_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid;
  v_rest_limit integer;
  v_used_count integer;
  v_remaining integer;
  v_today date;
  v_month_start date;
  v_month_end date;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get today's date (server date)
  v_today := CURRENT_DATE;
  
  -- Calculate month boundaries
  v_month_start := date_trunc('month', v_today)::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month')::date;

  -- Fetch the task and its rest limit (using qualified column names)
  SELECT t.rest_credits_per_month INTO v_rest_limit
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.user_id = v_user_id;

  -- Check if task exists and belongs to user
  IF v_rest_limit IS NULL THEN
    RAISE EXCEPTION 'Task not found or does not belong to user';
  END IF;

  -- Count rests used for this user/task within current month (using qualified column names)
  SELECT COUNT(*) INTO v_used_count
  FROM public.task_rests tr
  WHERE tr.user_id = v_user_id
    AND tr.task_id = p_task_id
    AND tr.rested_on >= v_month_start
    AND tr.rested_on < v_month_end;

  -- Calculate remaining
  v_remaining := GREATEST(0, v_rest_limit - v_used_count);

  -- Return JSON with task_id, monthly_limit, used, and remaining
  RETURN json_build_object(
    'task_id', p_task_id,
    'monthly_limit', v_rest_limit,
    'used', v_used_count,
    'remaining', v_remaining
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_task_rest_credits(uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_task_rest_credits(uuid) IS 'Returns rest credits info (task_id, monthly_limit, used, remaining) for a task in the current month. Does not modify data.';

