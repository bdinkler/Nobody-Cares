import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

export type RollingConsistency = {
  user_id: string;
  window_start: string;
  window_end: string;
  eligible_instances: number;
  completed_instances: number;
  completion_pct: number;
};

export function useRollingConsistency() {
  const [data, setData] = useState<RollingConsistency | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConsistency = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setData(null);
        setLoading(false);
        return;
      }

      // Use RPC function that computes "today" based on user's timezone
      // This ensures calendar day boundaries align with user's local midnight
      // Note: RPC functions return arrays, so we need to access the first element
      const { data: consistencyDataArray, error: fetchError } = await supabase
        .rpc('get_my_rolling_30d_consistency');

      if (fetchError) {
        console.error('[useRollingConsistency] Error fetching consistency:', fetchError);
        setError(fetchError.message);
        setData(null);
      } else if (consistencyDataArray && consistencyDataArray.length > 0) {
        // RPC returns array - take first row
        setData(consistencyDataArray[0]);
      } else {
        // No data returned - return zero values as fallback
        console.warn('[useRollingConsistency] No data returned from RPC, using zero values');
        setData({
          user_id: user.id,
          window_start: new Date().toISOString().split('T')[0],
          window_end: new Date().toISOString().split('T')[0],
          eligible_instances: 0,
          completed_instances: 0,
          completion_pct: 0,
        });
      }
    } catch (err) {
      console.error('[useRollingConsistency] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConsistency();
  }, [fetchConsistency]);

  return {
    completionPct: data?.completion_pct ?? 0,
    eligibleCount: data?.eligible_instances ?? 0,
    completedCount: data?.completed_instances ?? 0,
    loading,
    error,
    refetch: fetchConsistency,
  };
}

