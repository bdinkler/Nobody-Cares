import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

// Post scope constant for feed posts
const POST_SCOPE_FEED = 'global';

export type PostWithReactions = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  image_urls?: string[] | null;
  author_first_name: string | null;
  author_avatar_url: string | null;
  like_count: number;
  is_liked: boolean;
};

export function useFeed() {
  const [posts, setPosts] = useState<PostWithReactions[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user ID for checking likes
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      // Fetch posts (newest first, limit 50)
      // Filter to global scope feed posts only
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('id, author_id, body, created_at, image_urls')
        .eq('scope', POST_SCOPE_FEED)
        .order('created_at', { ascending: false })
        .limit(50);

      if (postsError) {
        console.error('[useFeed] Error fetching posts:', postsError);
        setError(postsError.message);
        setLoading(false);
        return;
      }

      if (!postsData || postsData.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }

      // Get unique author IDs
      const authorIds = [...new Set(postsData.map((p) => p.author_id))];
      const postIds = postsData.map((p) => p.id);

      // Fetch profiles for all authors
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, first_name, avatar_url')
        .in('id', authorIds);

      if (profilesError) {
        console.error('[useFeed] Error fetching profiles:', profilesError);
        // Continue with empty profiles
      }

      // Create profiles map for easy lookup
      const profilesMap = new Map(
        (profilesData || []).map((p) => [p.id, { first_name: p.first_name, avatar_url: p.avatar_url }])
      );

      // Fetch all reactions for these posts (only columns that exist)
      const { data: reactionsData, error: reactionsError } = await supabase
        .from('post_reactions')
        .select('post_id, user_id, created_at')
        .in('post_id', postIds);

      // If reactions query fails, preserve previous reaction state
      if (reactionsError) {
        console.warn('[useFeed] Error fetching reactions (non-blocking):', {
          message: reactionsError.message,
          details: reactionsError.details,
          hint: reactionsError.hint,
          code: reactionsError.code,
        });
        // Preserve previous reaction state by building map from current posts
        setPosts((prevPosts) => {
          const prevReactionsMap = new Map<string, { count: number; isLiked: boolean }>();
          prevPosts.forEach((post) => {
            if (postIds.includes(post.id)) {
              prevReactionsMap.set(post.id, {
                count: post.like_count,
                isLiked: post.is_liked,
              });
            }
          });
          
          // Update posts with new data but preserve reaction state
          return postsData.map((post) => {
            const profile = profilesMap.get(post.author_id);
            const reactions = prevReactionsMap.get(post.id) || { count: 0, isLiked: false };
            return {
              ...post,
              author_first_name: profile?.first_name || null,
              author_avatar_url: profile?.avatar_url || null,
              like_count: reactions.count,
              is_liked: reactions.isLiked,
            };
          });
        });
        setLoading(false);
        return;
      }

      // Count likes per post and check if current user liked each post
      const reactionsMap = new Map<string, { count: number; isLiked: boolean }>();

      // Count likes per post and check if current user liked each post
      (reactionsData || []).forEach((reaction) => {
        const key = reaction.post_id;
        const current = reactionsMap.get(key) || { count: 0, isLiked: false };
        reactionsMap.set(key, {
          count: current.count + 1,
          isLiked: current.isLiked || reaction.user_id === user.id,
        });
      });

      // Combine posts with author info and reactions
      const postsWithReactions: PostWithReactions[] = postsData.map((post) => {
        const profile = profilesMap.get(post.author_id);
        const reactions = reactionsMap.get(post.id) || { count: 0, isLiked: false };

        return {
          ...post,
          author_first_name: profile?.first_name || null,
          author_avatar_url: profile?.avatar_url || null,
          like_count: reactions.count,
          is_liked: reactions.isLiked,
        };
      });

      setPosts(postsWithReactions);
    } catch (err) {
      console.error('[useFeed] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleLike = useCallback(async (postId: string, currentIsLiked: boolean) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('[useFeed] Error getting user for like:', authError);
        return;
      }

      // Optimistic update - update UI immediately
      setPosts((prevPosts) =>
        prevPosts.map((post) => {
          if (post.id === postId) {
            return {
              ...post,
              is_liked: !currentIsLiked,
              like_count: currentIsLiked ? post.like_count - 1 : post.like_count + 1,
            };
          }
          return post;
        })
      );

      if (currentIsLiked) {
        // Unlike: delete the reaction row
        const { error: deleteError } = await supabase
          .from('post_reactions')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);

        if (deleteError) {
          console.error('[useFeed] Error deleting reaction:', {
            message: deleteError.message,
            details: deleteError.details,
            hint: deleteError.hint,
            code: deleteError.code,
            postId,
            userId: user.id,
          });
          // Revert optimistic update on error
          setPosts((prevPosts) =>
            prevPosts.map((post) => {
              if (post.id === postId) {
                return {
                  ...post,
                  is_liked: currentIsLiked,
                  like_count: currentIsLiked ? post.like_count : post.like_count - 1,
                };
              }
              return post;
            })
          );
          return;
        }
      } else {
        // Like: insert the reaction row
        const insertData = {
          post_id: postId,
          user_id: user.id,
        };

        const { error: insertError } = await supabase
          .from('post_reactions')
          .insert(insertData);

        if (insertError) {
          // Check if it's a unique constraint error (already liked - race condition)
          if (insertError.code === '23505') {
            // Already liked, that's fine - refetch to sync state
            fetchPosts();
            return;
          }
          console.error('[useFeed] Error inserting reaction:', {
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint,
            code: insertError.code,
            payloadKeys: Object.keys(insertData),
            payload: insertData,
          });
          // Revert optimistic update on error
          setPosts((prevPosts) =>
            prevPosts.map((post) => {
              if (post.id === postId) {
                return {
                  ...post,
                  is_liked: currentIsLiked,
                  like_count: currentIsLiked ? post.like_count + 1 : post.like_count,
                };
              }
              return post;
            })
          );
          return;
        }
      }

      // Refetch to ensure consistency with server state
      fetchPosts();
    } catch (err) {
      console.error('[useFeed] Unexpected error in toggleLike:', err);
      // Revert optimistic update on error
      setPosts((prevPosts) =>
        prevPosts.map((post) => {
          if (post.id === postId) {
            return {
              ...post,
              is_liked: currentIsLiked,
              like_count: currentIsLiked ? post.like_count + 1 : post.like_count - 1,
            };
          }
          return post;
        })
      );
    }
  }, [fetchPosts]);

  const createPost = useCallback(async (body: string) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated');
      }

      const insertPayload = {
        author_id: user.id,
        body: body.trim(),
        scope: POST_SCOPE_FEED,
        cycle_cohort_id: null,
        image_urls: null,
      };

      const { error: insertError } = await supabase.from('posts').insert(insertPayload);

      if (insertError) {
        // Enhanced error logging with actionable details
        console.error('[useFeed] Error creating post:', {
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code,
          payloadKeys: Object.keys(insertPayload),
          payload: insertPayload,
        });
        throw insertError;
      }

      // Refetch posts to show the new one
      await fetchPosts();
    } catch (err) {
      console.error('[useFeed] Unexpected error creating post:', err);
      throw err;
    }
  }, [fetchPosts]);

  const deletePost = useCallback(async (postId: string) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated');
      }

      // Optimistic update - remove post from UI immediately
      setPosts((prevPosts) => prevPosts.filter((post) => post.id !== postId));

      // Delete reactions first (if cascade not configured)
      // Try to delete reactions, but don't fail if it errors (might be cascade)
      const { error: reactionsDeleteError } = await supabase
        .from('post_reactions')
        .delete()
        .eq('post_id', postId);

      if (reactionsDeleteError && reactionsDeleteError.code !== 'PGRST116') {
        // PGRST116 = no rows found, which is fine
        console.warn('[useFeed] Error deleting reactions (may be cascade):', {
          message: reactionsDeleteError.message,
          code: reactionsDeleteError.code,
        });
        // Continue anyway - might be cascade delete configured
      }

      // Delete the post
      const { error: deleteError } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('author_id', user.id); // Ensure only author can delete

      if (deleteError) {
        console.error('[useFeed] Error deleting post:', {
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
          code: deleteError.code,
          postId,
          userId: user.id,
        });
        // Revert optimistic update
        fetchPosts();
        throw deleteError;
      }

      // Refetch to ensure consistency
      await fetchPosts();
    } catch (err) {
      console.error('[useFeed] Unexpected error deleting post:', err);
      // Revert optimistic update on error
      fetchPosts();
      throw err;
    }
  }, [fetchPosts]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  return {
    posts,
    loading,
    error,
    refetch: fetchPosts,
    toggleLike,
    createPost,
    deletePost,
  };
}

