import { getLocalDateYYYYMMDD } from '@/src/lib/date-utils';
import { supabase } from '@/src/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

/**
 * Hook to fetch and manage today's task completions from Supabase.
 * Returns a Set of completed task IDs for efficient lookup.
 */
export function useTodaysCompletions() {
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompletions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setCompletedTaskIds(new Set());
        setLoading(false);
        return;
      }

      const today = getLocalDateYYYYMMDD();
      const { data, error: completionsError } = await supabase
        .from('task_completions')
        .select('task_id')
        .eq('user_id', user.id)
        .eq('completed_on', today);

      if (completionsError) {
        console.error('[useTodaysCompletions] Error fetching completions:', completionsError);
        setError(completionsError.message);
        setCompletedTaskIds(new Set());
      } else {
        const taskIdSet = new Set<string>((data || []).map((c) => c.task_id));
        setCompletedTaskIds(taskIdSet);
      }
    } catch (err) {
      console.error('[useTodaysCompletions] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCompletedTaskIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompletions();
  }, [fetchCompletions]);

  return {
    completedTaskIds,
    loading,
    error,
    refetch: fetchCompletions,
  };
}

