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

-- PART D: Create RPC function
-- Drop ALL overloads of the function to avoid ambiguity
-- PostgreSQL uses parameter types (not names) for function signatures
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
    RETURNING id INTO v_cycle_id;
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
'Ensures a monthly cycle exists for the current month and assigns the current user to a cohort. Finds or creates an open cohort (capacity up to 25). Returns cohort metadata including cycle_id, cycle_cohort_id, cohort_number, member_count, and resets_on date. Idempotent: if user is already assigned, returns existing cohort data. NOTE: Category is fixed to ''general'' - all users can be in any cohort.';

