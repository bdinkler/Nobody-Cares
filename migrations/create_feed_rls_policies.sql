-- Migration: Create RLS policies for Feed MVP
-- This ensures authenticated users can read/write posts and reactions

-- Enable RLS on posts table (if not already enabled)
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on post_reactions table (if not already enabled)
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;

-- Posts: Authenticated users can select all posts
DROP POLICY IF EXISTS "Authenticated users can select posts" ON public.posts;
CREATE POLICY "Authenticated users can select posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (true);

-- Posts: Authenticated users can insert their own posts
DROP POLICY IF EXISTS "Authenticated users can insert posts" ON public.posts;
CREATE POLICY "Authenticated users can insert posts"
  ON public.posts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);

-- Posts: Authenticated users can delete their own posts
DROP POLICY IF EXISTS "Authenticated users can delete their own posts" ON public.posts;
CREATE POLICY "Authenticated users can delete their own posts"
  ON public.posts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);

-- Post reactions: Authenticated users can select all reactions
DROP POLICY IF EXISTS "Authenticated users can select reactions" ON public.post_reactions;
CREATE POLICY "Authenticated users can select reactions"
  ON public.post_reactions
  FOR SELECT
  TO authenticated
  USING (true);

-- Post reactions: Authenticated users can insert their own reactions
DROP POLICY IF EXISTS "Authenticated users can insert reactions" ON public.post_reactions;
CREATE POLICY "Authenticated users can insert reactions"
  ON public.post_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Post reactions: Authenticated users can delete their own reactions
DROP POLICY IF EXISTS "Authenticated users can delete their own reactions" ON public.post_reactions;
CREATE POLICY "Authenticated users can delete their own reactions"
  ON public.post_reactions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

