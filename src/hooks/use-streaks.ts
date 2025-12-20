import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

/**
 * Hook for fetching execution streaks from the user_streaks view.
 * 
 * Streaks are based on 100% completion of eligible tasks (excluding rested tasks).
 * Today is excluded - streaks only count fully finished days.
 * - Current streak: consecutive successful days ending at yesterday
 * - Best streak: longest consecutive successful days in history
 */
export function useStreaks() {
  const [currentStreak, setCurrentStreak] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStreaks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setCurrentStreak(0);
        setBestStreak(0);
        setLoading(false);
        return;
      }

      const { data: streakData, error: fetchError } = await supabase
        .from('user_streaks')
        .select('current_streak, best_streak')
        .eq('user_id', user.id)
        .single();

      if (fetchError) {
        // If no row found, user might have no active tasks or no data yet
        if (fetchError.code === 'PGRST116') {
          // No rows returned - return zero values
          setCurrentStreak(0);
          setBestStreak(0);
        } else {
          console.error('[useStreaks] Error fetching streaks:', fetchError);
          setError(fetchError.message);
          setCurrentStreak(0);
          setBestStreak(0);
        }
      } else {
        setCurrentStreak(streakData?.current_streak ?? 0);
        setBestStreak(streakData?.best_streak ?? 0);
      }
    } catch (err) {
      console.error('[useStreaks] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCurrentStreak(0);
      setBestStreak(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreaks();
  }, [fetchStreaks]);

  return {
    currentStreak,
    bestStreak,
    loading,
    error,
    refetch: fetchStreaks,
  };
}
