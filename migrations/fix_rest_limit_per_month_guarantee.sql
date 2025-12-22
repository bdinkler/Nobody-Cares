-- Migration: Guarantee rest_limit_per_month is never NULL
-- This migration ensures rest_limit_per_month always has a value through:
-- 1. Column-level DEFAULT (safety net)
-- 2. BEFORE INSERT/UPDATE trigger (sets value based on title if NULL)
-- 3. Backfill existing NULL rows

-- Step 1: Ensure column has DEFAULT 0
-- This provides a safety net if trigger somehow doesn't fire
ALTER TABLE public.tasks
ALTER COLUMN rest_limit_per_month SET DEFAULT 0;

-- Step 2: Backfill any existing NULL values
-- First, set built-in tasks based on exact title match
UPDATE public.tasks
SET rest_limit_per_month = 4
WHERE title = 'Workout' AND rest_limit_per_month IS NULL;

UPDATE public.tasks
SET rest_limit_per_month = 8
WHERE title = 'Deep Work' AND rest_limit_per_month IS NULL;

-- Then, set all remaining NULL values to 0 (custom tasks and any others)
UPDATE public.tasks
SET rest_limit_per_month = 0
WHERE rest_limit_per_month IS NULL;

-- Step 3: Create trigger function that sets rest_limit_per_month if NULL
-- This function only sets the value if it's NULL, never overrides explicit values
CREATE OR REPLACE FUNCTION public.set_rest_limit_if_null()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only set if NULL (never override explicitly provided values)
  IF NEW.rest_limit_per_month IS NULL THEN
    -- Use exact string matches on title (not fuzzy matching)
    IF NEW.title = 'Workout' THEN
      NEW.rest_limit_per_month := 4;
    ELSIF NEW.title = 'Deep Work' THEN
      NEW.rest_limit_per_month := 8;
    ELSE
      -- All other tasks (including custom) default to 0
      NEW.rest_limit_per_month := 0;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 4: Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS trigger_set_rest_limit_if_null ON public.tasks;

-- Step 5: Create trigger that fires BEFORE INSERT or UPDATE
-- BEFORE trigger allows us to modify NEW before it's written to the table
CREATE TRIGGER trigger_set_rest_limit_if_null
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.set_rest_limit_if_null();

-- Step 6: Add comment for documentation
COMMENT ON FUNCTION public.set_rest_limit_if_null() IS 'Trigger function that sets rest_limit_per_month based on exact title match if value is NULL. Never overrides explicitly provided values.';

