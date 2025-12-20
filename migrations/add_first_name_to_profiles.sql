-- Migration: Add first_name column to profiles table
-- Run this in your Supabase SQL Editor

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.first_name IS 'User first name for profile display';

