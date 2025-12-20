import { supabase } from '@/src/lib/supabase';
import { getTodayISODate } from '@/src/lib/date-utils';

/**
 * Check if a task title is eligible for rest.
 * Only "heavy" tasks can be rested: Workout, Deep Work, Read.
 */
export function isTaskEligibleForRest(taskTitle: string): boolean {
  const eligibleTitles = ['Workout', 'Deep Work', 'Read'];
  return eligibleTitles.includes(taskTitle);
}

/**
 * Get the count of rests used by the user in the current calendar month.
 * Returns the count of unique (user_id, task_id, rested_on) rows for the current month.
 */
export async function getMonthlyRestCount(): Promise<number> {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Not authenticated');
    }

    // Get first and last day of current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Format as YYYY-MM-DD
    const firstDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(firstDay.getDate()).padStart(2, '0')}`;
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    const { count, error } = await supabase
      .from('task_rests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('rested_on', firstDayStr)
      .lte('rested_on', lastDayStr);

    if (error) {
      console.error('[getMonthlyRestCount] Error:', error);
      throw error;
    }

    return count || 0;
  } catch (err) {
    console.error('[getMonthlyRestCount] Unexpected error:', err);
    throw err;
  }
}

/**
 * Insert a rest for a task on today's date.
 */
export async function insertTaskRest(taskId: string): Promise<void> {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Not authenticated');
    }

    const todayStr = getTodayISODate();

    const { error: insertError } = await supabase
      .from('task_rests')
      .insert({
        user_id: user.id,
        task_id: taskId,
        rested_on: todayStr,
      });

    if (insertError) {
      // Check if error is due to unique constraint violation
      if (insertError.code === '23505' || insertError.message.includes('unique')) {
        // Already rested, treat as success
        console.log('[insertTaskRest] Task already rested');
      } else {
        console.error('[insertTaskRest] Error inserting rest:', insertError);
        throw insertError;
      }
    }
  } catch (err) {
    console.error('[insertTaskRest] Unexpected error:', err);
    throw err;
  }
}

