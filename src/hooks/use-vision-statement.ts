import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

/**
 * Hook to fetch the user's vision statement from profiles table.
 * Returns the vision statement or null if not set.
 */
export function useVisionStatement() {
  const [visionStatement, setVisionStatement] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVision = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setVisionStatement(null);
        setLoading(false);
        return;
      }

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('vision_statement')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('[useVisionStatement] Error fetching profile:', profileError);
        setError(profileError.message);
        setVisionStatement(null);
      } else {
        setVisionStatement(data?.vision_statement || null);
      }
    } catch (err) {
      console.error('[useVisionStatement] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setVisionStatement(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVision();
  }, [fetchVision]);

  return {
    visionStatement,
    loading,
    error,
    refetch: fetchVision,
  };
}

