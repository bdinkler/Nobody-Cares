import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

/**
 * Hook for fetching execution streaks from the user_execution_streaks view.
 * 
 * Streaks are based on 100% completion of eligible tasks (excluding rested tasks).
 * Today is excluded - streaks only count fully finished days (up to yesterday).
 * - Current streak: consecutive executed days ending at yesterday
 * - Best streak: longest consecutive executed days in history
 */
export function useExecutionStreaks() {
  const [currentStreakDays, setCurrentStreakDays] = useState<number>(0);
  const [bestStreakDays, setBestStreakDays] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStreaks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setCurrentStreakDays(0);
        setBestStreakDays(0);
        setLoading(false);
        return;
      }

      const { data: streakData, error: fetchError } = await supabase
        .from('user_execution_streaks')
        .select('current_streak_days, best_streak_days')
        .eq('user_id', user.id)
        .single();

      if (fetchError) {
        // If no row found, user might have no active tasks or no data yet
        if (fetchError.code === 'PGRST116') {
          // No rows returned - return zero values
          console.log('[useExecutionStreaks] No streak data found for user, returning 0');
          setCurrentStreakDays(0);
          setBestStreakDays(0);
        } else {
          console.error('[useExecutionStreaks] Error fetching streaks:', fetchError);
          setError(fetchError.message);
          setCurrentStreakDays(0);
          setBestStreakDays(0);
        }
      } else {
        console.log('[useExecutionStreaks] Streak data:', streakData);
        setCurrentStreakDays(streakData?.current_streak_days ?? 0);
        setBestStreakDays(streakData?.best_streak_days ?? 0);
      }
    } catch (err) {
      console.error('[useExecutionStreaks] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCurrentStreakDays(0);
      setBestStreakDays(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreaks();
  }, [fetchStreaks]);

  return {
    currentStreakDays,
    bestStreakDays,
    loading,
    error,
    refetch: fetchStreaks,
  };
}
