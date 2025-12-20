-- Migration: Add duration_minutes column to tasks table
-- Run this in your Supabase SQL Editor

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN public.tasks.duration_minutes IS 'Duration in minutes for tasks that support time tracking (e.g., Workout, Deep Work). NULL for tasks without duration.';

