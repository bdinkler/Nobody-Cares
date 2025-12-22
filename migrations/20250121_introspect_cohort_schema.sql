-- ============================================
-- Schema Introspection: Cohort-related tables and views
-- This file contains read-only queries to inspect the actual database schema.
-- Run these queries in Supabase SQL Editor to confirm table structures.
-- ============================================

-- ============================================
-- PART 1: Column Information for Cohort Tables
-- ============================================

-- 1.1: public.cohort_cycles columns
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'cohort_cycles'
ORDER BY ordinal_position;

-- 1.2: public.cycle_cohorts columns
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'cycle_cohorts'
ORDER BY ordinal_position;

-- 1.3: public.cycle_cohort_members columns
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'cycle_cohort_members'
ORDER BY ordinal_position;

-- 1.4: public.monthly_cohort_rankings columns (if exists)
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'monthly_cohort_rankings'
ORDER BY ordinal_position;

-- 1.5: public.user_monthly_cohort_consistency view columns
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'user_monthly_cohort_consistency'
ORDER BY ordinal_position;

-- ============================================
-- PART 2: Enum Values for goal_category
-- ============================================

-- 2.1: List all enum types related to goal/category
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS enum_value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname LIKE '%goal%' OR t.typname LIKE '%category%'
ORDER BY t.typname, e.enumsortorder;

-- 2.2: Specifically for goal_category enum
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS enum_value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'goal_category'
ORDER BY e.enumsortorder;

-- ============================================
-- PART 3: Foreign Key Relationships
-- ============================================

-- 3.1: Foreign keys FROM cycle_cohorts
SELECT
  tc.table_name AS source_table,
  kcu.column_name AS source_column,
  ccu.table_name AS target_table,
  ccu.column_name AS target_column,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name = 'cycle_cohorts'
ORDER BY tc.table_name, kcu.column_name;

-- 3.2: Foreign keys FROM cycle_cohort_members
SELECT
  tc.table_name AS source_table,
  kcu.column_name AS source_column,
  ccu.table_name AS target_table,
  ccu.column_name AS target_column,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name = 'cycle_cohort_members'
ORDER BY tc.table_name, kcu.column_name;

-- 3.3: Foreign keys TO cohort_cycles (what references it)
SELECT
  tc.table_name AS source_table,
  kcu.column_name AS source_column,
  ccu.table_name AS target_table,
  ccu.column_name AS target_column,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_name = 'cohort_cycles'
ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- PART 4: Unique Constraints and Indexes
-- ============================================

-- 4.1: Unique constraints on cohort tables
SELECT
  tc.table_name,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('cohort_cycles', 'cycle_cohorts', 'cycle_cohort_members')
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name, tc.constraint_name;

-- 4.2: Primary keys
SELECT
  tc.table_name,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('cohort_cycles', 'cycle_cohorts', 'cycle_cohort_members')
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- PART 5: Sample Data Check (optional, for debugging)
-- ============================================

-- 5.1: Check if cohort_cycles has any rows with date columns
-- Note: Only select columns that exist (created_at may not exist)
SELECT 
  id, 
  category, 
  start_date, 
  end_date,
  COUNT(*) OVER () AS total_rows
FROM public.cohort_cycles
ORDER BY COALESCE(start_date, '1970-01-01'::date) DESC
LIMIT 5;

-- 5.2: Check cycle_cohorts structure
-- Note: Only select columns that exist (created_at may not exist)
SELECT 
  id, 
  cycle_id, 
  cohort_number, 
  category,
  COUNT(*) OVER () AS total_rows
FROM public.cycle_cohorts
ORDER BY cohort_number DESC
LIMIT 5;

-- 5.3: Check cycle_cohort_members sample
-- Note: Only select columns that exist (created_at may not exist)
SELECT 
  cycle_cohort_id,
  user_id,
  joined_at,
  COUNT(*) OVER () AS total_rows
FROM public.cycle_cohort_members
ORDER BY COALESCE(joined_at, '1970-01-01'::timestamp) DESC
LIMIT 5;

-- ============================================
-- PART 6: Check profiles table for goal_category column
-- ============================================

-- 6.1: Does profiles table have goal_category?
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
  AND column_name LIKE '%goal%' OR column_name LIKE '%category%'
ORDER BY ordinal_position;

-- 6.2: All profiles columns (for reference)
SELECT 
  column_name, 
  data_type, 
  udt_name,
  is_nullable,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

