-- ============================================
-- Migration: Ensure monthly cycle exists and assign user to cohort (FIXED)
-- - Creates monthly cycle if it doesn't exist (using start_date/end_date)
-- - Finds or creates an open cohort (capacity up to 25)
-- - Assigns current user to cohort
-- - Returns cohort metadata
-- - NOTE: Category/goal_category is NOT used for cohort grouping (all users can be in any cohort)
-- ============================================

-- PART A: Ensure unique constraint for monthly cycles
-- Note: category is required (NOT NULL) but we use a single default value for all cycles
DO $$
BEGIN
  -- Ensure unique constraint exists (category + dates)
  -- Since category is required, we'll use a default value for all cycles
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'cohort_cycles_category_month_unique'
  ) THEN
    ALTER TABLE public.cohort_cycles 
    ADD CONSTRAINT cohort_cycles_category_month_unique 
    UNIQUE (category, start_date, end_date);
  END IF;
END $$;

-- PART B: Ensure unique constraint for membership
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'cycle_cohort_members_unique'
  ) THEN
    ALTER TABLE public.cycle_cohort_members 
    ADD CONSTRAINT cycle_cohort_members_unique 
    UNIQUE (cycle_cohort_id, user_id);
  END IF;
END $$;

-- PART C: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cohort_cycles_dates 
ON public.cohort_cycles(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_cycle_cohorts_cycle_id 
ON public.cycle_cohorts(cycle_id);

CREATE INDEX IF NOT EXISTS idx_cycle_cohort_members_cohort_user 
ON public.cycle_cohort_members(cycle_cohort_id, user_id);

-- PART D: Helper function to get default category (first enum value)
CREATE OR REPLACE FUNCTION public.get_default_goal_category()
RETURNS goal_category
LANGUAGE sql
STABLE
AS $$
  SELECT enumlabel::goal_category
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'goal_category'
  ORDER BY e.enumsortorder
  LIMIT 1;
$$;

-- PART E: Create RPC function
DROP FUNCTION IF EXISTS public.ensure_monthly_cycle_and_assign_user();

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
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_category goal_category;
  v_month_start date;
  v_month_end date;
  v_cycle_id uuid;
  v_cohort_id uuid;
  v_cohort_number integer;
  v_member_count bigint;
  v_resets_on date;
  v_max_members integer := 25;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Use default category (we're not grouping by category, but column is required)
  v_category := public.get_default_goal_category();

  -- Calculate current month boundaries
  v_month_start := DATE_TRUNC('month', CURRENT_DATE)::date;
  v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
  v_resets_on := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::date;

  -- Find or create the current month cycle
  -- Match by category (default), start_date, and end_date
  SELECT id INTO v_cycle_id
  FROM public.cohort_cycles
  WHERE category = v_category
    AND start_date = v_month_start
    AND end_date = v_month_end
  LIMIT 1;

  IF v_cycle_id IS NULL THEN
    -- Create new cycle for current month
    -- Category is required (NOT NULL), so we use the default
    INSERT INTO public.cohort_cycles (category, start_date, end_date)
    VALUES (v_category, v_month_start, v_month_end)
    ON CONFLICT (category, start_date, end_date) DO NOTHING
    RETURNING id INTO v_cycle_id;
    
    -- If INSERT didn't return a value (conflict occurred), fetch the existing row
    IF v_cycle_id IS NULL THEN
      SELECT id INTO v_cycle_id
      FROM public.cohort_cycles
      WHERE category = v_category
        AND start_date = v_month_start
        AND end_date = v_month_end
      LIMIT 1;
    END IF;
  END IF;

  -- Check if user is already assigned to a cohort in this cycle
  SELECT ccm.cycle_cohort_id INTO v_cohort_id
  FROM public.cycle_cohort_members ccm
  INNER JOIN public.cycle_cohorts cc ON ccm.cycle_cohort_id = cc.id
  WHERE ccm.user_id = v_user_id
    AND cc.cycle_id = v_cycle_id
  LIMIT 1;

  IF v_cohort_id IS NOT NULL THEN
    -- User already assigned, return existing cohort data
    SELECT 
      cc.cohort_number,
      COUNT(ccm.user_id) AS cnt
    INTO v_cohort_number, v_member_count
    FROM public.cycle_cohorts cc
    LEFT JOIN public.cycle_cohort_members ccm ON ccm.cycle_cohort_id = cc.id
    WHERE cc.id = v_cohort_id
    GROUP BY cc.id, cc.cohort_number;

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

  -- Find a cohort with available space (less than max_members)
  -- Prioritize cohorts with more members (to fill them up)
  SELECT 
    cc.id,
    cc.cohort_number,
    COUNT(ccm.user_id) AS cnt
  INTO v_cohort_id, v_cohort_number, v_member_count
  FROM public.cycle_cohorts cc
  LEFT JOIN public.cycle_cohort_members ccm ON ccm.cycle_cohort_id = cc.id
  WHERE cc.cycle_id = v_cycle_id
  GROUP BY cc.id, cc.cohort_number
  HAVING COUNT(ccm.user_id) < v_max_members
  ORDER BY COUNT(ccm.user_id) DESC, cc.cohort_number ASC
  LIMIT 1;

  IF v_cohort_id IS NULL THEN
    -- No available cohort, create a new one
    -- Get the next cohort_number for this cycle
    SELECT COALESCE(MAX(cohort_number), 0) + 1 INTO v_cohort_number
    FROM public.cycle_cohorts
    WHERE cycle_id = v_cycle_id;

    -- Create new cohort
    -- Category is required, use the same default as the cycle
    INSERT INTO public.cycle_cohorts (cycle_id, cohort_number, category)
    VALUES (v_cycle_id, v_cohort_number, v_category)
    RETURNING id INTO v_cohort_id;
    
    v_member_count := 0;
  END IF;

  -- Assign user to cohort (with joined_at = now)
  INSERT INTO public.cycle_cohort_members (cycle_cohort_id, user_id, joined_at)
  VALUES (v_cohort_id, v_user_id, NOW())
  ON CONFLICT (cycle_cohort_id, user_id) DO NOTHING;

  -- Recalculate member count after insertion
  SELECT COUNT(ccm.user_id) INTO v_member_count
  FROM public.cycle_cohort_members ccm
  WHERE ccm.cycle_cohort_id = v_cohort_id;

  -- Return cohort metadata
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

COMMENT ON FUNCTION public.ensure_monthly_cycle_and_assign_user() IS
'Ensures a monthly cycle exists for the current month and assigns the current user to a cohort. Finds or creates an open cohort (capacity up to 25). Returns cohort metadata including cycle_id, cycle_cohort_id, cohort_number, member_count, and resets_on date. Idempotent: if user is already assigned, returns existing cohort data. NOTE: Category is not used for grouping - all users can be in any cohort.';

