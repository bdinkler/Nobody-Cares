-- Migration: Add phone column to profiles table
-- Run this in your Supabase SQL Editor

-- Add phone column if it doesn't exist
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.phone IS 'Phone number (E.164 format preferred, but not enforced for MVP)';

