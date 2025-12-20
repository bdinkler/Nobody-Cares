-- Migration: Create task_rests table
-- Run this in your Supabase SQL Editor

-- Create table
CREATE TABLE IF NOT EXISTS public.task_rests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  rested_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add unique constraint to prevent duplicate rests for same task on same day
ALTER TABLE public.task_rests
ADD CONSTRAINT task_rests_user_task_date_unique 
UNIQUE (user_id, task_id, rested_on);

-- Create index for efficient queries by user and date
CREATE INDEX IF NOT EXISTS idx_task_rests_user_date 
ON public.task_rests(user_id, rested_on);

-- Enable Row Level Security
ALTER TABLE public.task_rests ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only select their own rests
CREATE POLICY "Users can select their own task rests"
ON public.task_rests
FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policy: Users can only insert their own rests
CREATE POLICY "Users can insert their own task rests"
ON public.task_rests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can only delete their own rests
CREATE POLICY "Users can delete their own task rests"
ON public.task_rests
FOR DELETE
USING (auth.uid() = user_id);

-- Add comments for documentation
COMMENT ON TABLE public.task_rests IS 'Tracks daily task rests for accountability tracking';
COMMENT ON COLUMN public.task_rests.rested_on IS 'Date (YYYY-MM-DD) when the task was rested';

