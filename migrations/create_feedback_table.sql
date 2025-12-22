-- Migration: Create feedback table
-- Run this in your Supabase SQL Editor

-- Create feedback table
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for efficient queries by user
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback(user_id);

-- Create index for efficient queries by created_at (for sorting)
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can insert their own feedback
CREATE POLICY "Users can insert their own feedback"
ON public.feedback
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can view their own feedback
CREATE POLICY "Users can view their own feedback"
ON public.feedback
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Add comments for documentation
COMMENT ON TABLE public.feedback IS 'Stores user feedback submissions for product development';
COMMENT ON COLUMN public.feedback.feedback_text IS 'The feedback text submitted by the user';
COMMENT ON COLUMN public.feedback.created_at IS 'Timestamp when the feedback was submitted';

