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

      const { data: consistencyData, error: fetchError } = await supabase
        .from('user_rolling_30d_consistency')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (fetchError) {
        // If no row found, user might have no active tasks or no data yet
        if (fetchError.code === 'PGRST116') {
          // No rows returned - return zero values
          setData({
            user_id: user.id,
            window_start: new Date().toISOString().split('T')[0],
            window_end: new Date().toISOString().split('T')[0],
            eligible_instances: 0,
            completed_instances: 0,
            completion_pct: 0,
          });
        } else {
          console.error('[useRollingConsistency] Error fetching consistency:', fetchError);
          setError(fetchError.message);
          setData(null);
        }
      } else {
        setData(consistencyData);
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

