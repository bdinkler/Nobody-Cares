import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

export type TaskRestCredits = {
  limit: number;
  used: number;
  remaining: number;
};

/**
 * Hook to fetch rest credits info for a specific task.
 * Returns limit, used count, and remaining credits for the current month.
 */
export function useTaskRestCredits(taskId: string | null) {
  const [credits, setCredits] = useState<TaskRestCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    if (!taskId) {
      setCredits(null);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload = { p_task_id: taskId };
      const { data, error: rpcError } = await supabase.rpc('get_task_rest_credits', payload);

      if (rpcError) {
        // Enhanced error logging with actionable details
        console.error('[useTaskRestCredits] RPC Error:', {
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
          code: rpcError.code,
          payloadKeys: Object.keys(payload),
          payload: payload,
        });
        setError(rpcError.message || 'Failed to fetch rest credits');
        setCredits(null);
      } else if (data) {
        setCredits({
          limit: data.limit || 0,
          used: data.used || 0,
          remaining: data.remaining || 0,
        });
      } else {
        setCredits(null);
      }
    } catch (err) {
      console.error('[useTaskRestCredits] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCredits(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  return {
    credits,
    loading,
    error,
    refetch: fetchCredits,
  };
}

