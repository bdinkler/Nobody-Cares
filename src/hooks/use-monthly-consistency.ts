import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

export type MonthlyConsistency = {
  user_id: string;
  month_start: string;
  month_end: string;
  eligible_instances: number;
  completed_instances: number;
  completion_pct: number;
};

export function useMonthlyConsistency(month?: Date) {
  const [data, setData] = useState<MonthlyConsistency | null>(null);
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

      // For now, the view only supports current month
      // In the future, we can extend this to support different months
      const { data: consistencyData, error: fetchError } = await supabase
        .from('user_monthly_consistency')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (fetchError) {
        // If no row found, user might have no active tasks or no data yet
        if (fetchError.code === 'PGRST116') {
          // No rows returned - return zero values
          setData({
            user_id: user.id,
            month_start: new Date().toISOString().split('T')[0],
            month_end: new Date().toISOString().split('T')[0],
            eligible_instances: 0,
            completed_instances: 0,
            completion_pct: 0,
          });
        } else {
          console.error('[useMonthlyConsistency] Error fetching consistency:', fetchError);
          setError(fetchError.message);
          setData(null);
        }
      } else {
        setData(consistencyData);
      }
    } catch (err) {
      console.error('[useMonthlyConsistency] Unexpected error:', err);
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

