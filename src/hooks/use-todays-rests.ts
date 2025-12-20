import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { getTodayISODate } from '@/src/lib/date-utils';

/**
 * Hook to fetch and manage today's task rests from Supabase.
 * Returns a Set of rested task IDs for efficient lookup.
 */
export function useTodaysRests() {
  const [restedTaskIds, setRestedTaskIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setRestedTaskIds(new Set());
        setLoading(false);
        return;
      }

      const today = getTodayISODate();
      const { data, error: restsError } = await supabase
        .from('task_rests')
        .select('task_id')
        .eq('user_id', user.id)
        .eq('rested_on', today);

      if (restsError) {
        console.error('[useTodaysRests] Error fetching rests:', restsError);
        setError(restsError.message);
        setRestedTaskIds(new Set());
      } else {
        const taskIdSet = new Set<string>((data || []).map((r) => r.task_id));
        setRestedTaskIds(taskIdSet);
      }
    } catch (err) {
      console.error('[useTodaysRests] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setRestedTaskIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRests();
  }, [fetchRests]);

  return {
    restedTaskIds,
    loading,
    error,
    refetch: fetchRests,
  };
}

