-- Migration: Create task_completions table
-- Run this in your Supabase SQL Editor

-- Create table
CREATE TABLE IF NOT EXISTS public.task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  completed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add unique constraint to prevent duplicate completions for same task on same day
ALTER TABLE public.task_completions
ADD CONSTRAINT task_completions_user_task_date_unique 
UNIQUE (user_id, task_id, completed_on);

-- Create index for efficient queries by user and date
CREATE INDEX IF NOT EXISTS idx_task_completions_user_date 
ON public.task_completions(user_id, completed_on);

-- Enable Row Level Security
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only select their own completions
CREATE POLICY "Users can select their own task completions"
ON public.task_completions
FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policy: Users can only insert their own completions
CREATE POLICY "Users can insert their own task completions"
ON public.task_completions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can only delete their own completions
CREATE POLICY "Users can delete their own task completions"
ON public.task_completions
FOR DELETE
USING (auth.uid() = user_id);

-- Add comments for documentation
COMMENT ON TABLE public.task_completions IS 'Tracks daily task completions for accountability tracking';
COMMENT ON COLUMN public.task_completions.completed_on IS 'Date (YYYY-MM-DD) when the task was completed';

