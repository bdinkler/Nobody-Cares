-- ============================================
-- Migration: Create function to assign user to monthly cohort
-- - Finds or creates the current month cycle (using start_date/end_date)
-- - Finds or creates a cohort within that cycle with available space
-- - Assigns user to exactly one cohort per cycle
-- - Uses category = 'default' (or adjust as needed)
-- ============================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.assign_user_to_monthly_cohort();

-- Create function to assign user to current month cohort
CREATE OR REPLACE FUNCTION public.assign_user_to_monthly_cohort()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_category text := 'default';
  v_month_start date;
  v_month_end date;
  v_cycle_id uuid;
  v_cohort_id uuid;
  v_cohort_number integer;
  v_member_count integer;
  v_max_members integer := 25;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Calculate current month boundaries
  v_month_start := DATE_TRUNC('month', CURRENT_DATE)::date;
  v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;

  -- Find or create the current month cycle
  SELECT id INTO v_cycle_id
  FROM public.cohort_cycles
  WHERE category = v_category
    AND start_date = v_month_start
    AND end_date = v_month_end
  LIMIT 1;

  IF v_cycle_id IS NULL THEN
    -- Create new cycle for current month
    INSERT INTO public.cohort_cycles (category, start_date, end_date)
    VALUES (v_category, v_month_start, v_month_end)
    RETURNING id INTO v_cycle_id;
  END IF;

  -- Check if user is already assigned to a cohort in this cycle
  SELECT cycle_cohort_id INTO v_cohort_id
  FROM public.cycle_cohort_members
  WHERE user_id = v_user_id
    AND cycle_cohort_id IN (
      SELECT id FROM public.cycle_cohorts WHERE cycle_id = v_cycle_id
    )
  LIMIT 1;

  IF v_cohort_id IS NOT NULL THEN
    -- User already assigned, return existing cohort
    RETURN v_cohort_id;
  END IF;

  -- Find a cohort with available space (less than max_members)
  SELECT 
    cc.id,
    COUNT(ccm.user_id) AS current_count
  INTO v_cohort_id, v_member_count
  FROM public.cycle_cohorts cc
  LEFT JOIN public.cycle_cohort_members ccm ON ccm.cycle_cohort_id = cc.id
  WHERE cc.cycle_id = v_cycle_id
  GROUP BY cc.id
  HAVING COUNT(ccm.user_id) < v_max_members
  ORDER BY COUNT(ccm.user_id) ASC
  LIMIT 1;

  IF v_cohort_id IS NULL THEN
    -- No available cohort, create a new one
    -- Get the next cohort_number for this cycle
    SELECT COALESCE(MAX(cohort_number), 0) + 1 INTO v_cohort_number
    FROM public.cycle_cohorts
    WHERE cycle_id = v_cycle_id;

    -- Create new cohort
    INSERT INTO public.cycle_cohorts (cycle_id, cohort_number, category)
    VALUES (v_cycle_id, v_cohort_number, v_category)
    RETURNING id INTO v_cohort_id;
  END IF;

  -- Assign user to cohort (with joined_at = now)
  INSERT INTO public.cycle_cohort_members (cycle_cohort_id, user_id, joined_at)
  VALUES (v_cohort_id, v_user_id, NOW())
  ON CONFLICT (cycle_cohort_id, user_id) DO NOTHING;

  -- Return the cohort_id (it's already set from earlier logic)
  RETURN v_cohort_id;
END;
$$;

COMMENT ON FUNCTION public.assign_user_to_monthly_cohort() IS
'Assigns the current authenticated user to a cohort for the current calendar month. Finds or creates the monthly cycle, finds or creates a cohort with available space (max 25 members), and assigns the user. Returns the cohort ID. Idempotent: if user is already assigned, returns existing cohort ID.';

