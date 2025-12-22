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

      // Use RPC function that computes streaks using timezone-safe logic
      // This ensures day boundaries align with user's local midnight
      const { data: streakDataArray, error: fetchError } = await supabase
        .rpc('get_execution_streaks', { p_user_id: user.id });

      // RPC returns array - take first row
      const streakData = streakDataArray && streakDataArray.length > 0 ? streakDataArray[0] : null;

      if (fetchError) {
        console.error('[useExecutionStreaks] Error fetching streaks:', fetchError);
        setError(fetchError.message);
        setCurrentStreakDays(0);
        setBestStreakDays(0);
      } else if (streakData) {
        console.log('[useExecutionStreaks] Streak data:', streakData);
        setCurrentStreakDays(streakData.current_streak_days ?? 0);
        setBestStreakDays(streakData.best_streak_days ?? 0);
      } else {
        // No data returned - return zero values
        console.warn('[useExecutionStreaks] No streak data returned from RPC, using zero values');
        setCurrentStreakDays(0);
        setBestStreakDays(0);
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
