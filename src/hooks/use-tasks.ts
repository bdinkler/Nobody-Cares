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

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveTasks = useCallback(async () => {
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
        console.error('[useTasks] Error fetching tasks:', tasksError);
        setError(tasksError.message);
        setTasks([]);
      } else {
        setTasks(data || []);
      }
    } catch (err) {
      console.error('[useTasks] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveTasks();
  }, [fetchActiveTasks]);

  const addTask = useCallback(async ({ name, duration_minutes }: { name: string; duration_minutes?: number | null }) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated');
      }

      // Check if task with same name exists but is inactive
      const { data: existingTask, error: checkError } = await supabase
        .from('tasks')
        .select('id, is_active')
        .eq('user_id', user.id)
        .eq('title', name)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 is "not found" which is fine
        throw checkError;
      }

      if (existingTask) {
        // Reactivate existing task
        const updateData: any = { is_active: true };
        if (duration_minutes !== undefined) {
          updateData.duration_minutes = duration_minutes;
        }

        const { error: updateError } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', existingTask.id);

        if (updateError) {
          throw updateError;
        }
      } else {
        // Insert new task
        const taskData: any = {
          user_id: user.id,
          title: name,
          is_active: true,
        };

        if (duration_minutes !== undefined && duration_minutes !== null) {
          taskData.duration_minutes = duration_minutes;
        }

        const { error: insertError } = await supabase
          .from('tasks')
          .insert(taskData);

        if (insertError) {
          throw insertError;
        }
      }

      // Refresh tasks list
      await fetchActiveTasks();
    } catch (err) {
      console.error('[useTasks] Error adding task:', err);
      throw err;
    }
  }, [fetchActiveTasks]);

  const updateTask = useCallback(async (taskId: string, { name, duration_minutes }: { name?: string; duration_minutes?: number | null }) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated');
      }

      const updateData: any = {};
      if (name !== undefined) {
        updateData.title = name;
      }
      if (duration_minutes !== undefined) {
        updateData.duration_minutes = duration_minutes;
      }

      const { error: updateError } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', taskId)
        .eq('user_id', user.id);

      if (updateError) {
        throw updateError;
      }

      // Refresh tasks list
      await fetchActiveTasks();
    } catch (err) {
      console.error('[useTasks] Error updating task:', err);
      throw err;
    }
  }, [fetchActiveTasks]);

  const deactivateTask = useCallback(async (taskId: string) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated');
      }

      const { error: updateError } = await supabase
        .from('tasks')
        .update({ is_active: false })
        .eq('id', taskId)
        .eq('user_id', user.id);

      if (updateError) {
        throw updateError;
      }

      // Refresh tasks list
      await fetchActiveTasks();
    } catch (err) {
      console.error('[useTasks] Error deactivating task:', err);
      throw err;
    }
  }, [fetchActiveTasks]);

  const reactivateTask = useCallback(async (taskId: string) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated');
      }

      const { error: updateError } = await supabase
        .from('tasks')
        .update({ is_active: true })
        .eq('id', taskId)
        .eq('user_id', user.id);

      if (updateError) {
        throw updateError;
      }

      // Refresh tasks list
      await fetchActiveTasks();
    } catch (err) {
      console.error('[useTasks] Error reactivating task:', err);
      throw err;
    }
  }, [fetchActiveTasks]);

  return {
    tasks,
    loading,
    error,
    refetch: fetchActiveTasks,
    addTask,
    updateTask,
    deactivateTask,
    reactivateTask,
  };
}

