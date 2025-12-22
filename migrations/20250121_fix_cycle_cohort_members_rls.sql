-- =========================================================
-- Migration: Fix cycle_cohort_members RLS recursion issue
-- =========================================================
--
-- Problem:
--   Infinite recursion occurs when an RLS policy on cycle_cohort_members
--   references the same table (directly or indirectly), causing Postgres
--   to recurse forever when evaluating the policy.
--
-- Solution:
--   We use a SECURITY DEFINER helper function (get_my_cycle_cohort_id) that
--   runs with elevated privileges and bypasses RLS. This allows the policy
--   to check the user's cohort membership without triggering recursion.
--
-- Why SECURITY DEFINER:
--   - The helper function runs with the privileges of the function owner
--   - It can query cycle_cohort_members without triggering RLS recursion
--   - This breaks the circular dependency that causes infinite recursion
--
-- Why no INSERT/UPDATE/DELETE policies:
--   - Users cannot self-join cohorts (system-assigned only)
--   - Cohort assignment is managed server-side, not by authenticated users
--   - Only SELECT is allowed so users can read their own cohort membership
--
-- MVP Rules:
--   - Posts are GLOBAL ONLY (no cohort posts for MVP)
--   - Users CANNOT self-join cohorts (system assigns cohorts)
--   - Cohort rankings are visible ONLY to the user and members of their cohort
-- =========================================================

-- =========================================================
-- CLEAN RLS for cycle_cohort_members (NO recursion)
-- Users:
--  - can read ONLY rows from their own cohort
--  - cannot insert/update/delete (system assigns cohorts)
-- Fixes: infinite recursion detected in policy for relation cycle_cohort_members
-- =========================================================

ALTER TABLE public.cycle_cohort_members ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies (clean slate)
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cycle_cohort_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cycle_cohort_members;', p.policyname);
  END LOOP;
END $$;

-- SECURITY DEFINER helper: get my cohort_id
CREATE OR REPLACE FUNCTION public.get_my_cycle_cohort_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ccm.cycle_cohort_id
  FROM public.cycle_cohort_members ccm
  WHERE ccm.user_id = auth.uid()
  LIMIT 1;
$$;

-- SELECT policy: allow reading rows only from my cohort
CREATE POLICY "ccm_select_my_cohort_only"
ON public.cycle_cohort_members
FOR SELECT
TO authenticated
USING (
  cycle_cohort_id = public.get_my_cycle_cohort_id()
);

-- No INSERT/UPDATE/DELETE policies for authenticated users (system-only changes)

-- Notes:
-- - This avoids RLS recursion by not referencing cycle_cohort_members inside its own policy.
-- - Membership reads are restricted to the user's cohort only.
-- - Writes are intentionally blocked for authenticated users because cohort assignment is system-managed.

