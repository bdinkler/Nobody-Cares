import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

export type Task = {
  id: string;
  user_id: string;
  title: string;
  is_active: boolean;
  duration_minutes: number | null;
  created_at?: string;
};

export function useTodaysTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      const { data, error: tasksError } = await supabase
        .from('tasks')
        .select('id, user_id, title, is_active, duration_minutes, created_at')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (tasksError) {
        console.error('[useTodaysTasks] Error fetching tasks:', tasksError);
        setError(tasksError.message);
        setTasks([]);
      } else {
        setTasks(data || []);
      }
    } catch (err) {
      console.error('[useTodaysTasks] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    loading,
    error,
    refetch: fetchTasks,
  };
}

