import { useMemo } from 'react';

/**
 * Computes daily outcome and completion percentage for cohort ranking.
 * 
 * Binary outcome rules:
 * - "Executed" ONLY if 100% of tasks are completed
 * - Otherwise "Missed" (even if 9/10 completed)
 * 
 * @param completedCount Number of completed tasks
 * @param totalCount Total number of active tasks
 * @returns Object with outcome status and completion percentage (0..1)
 * 
 * Note: completionPct is computed for future cohort ranking but not displayed on Home screen.
 */
export function useDailyOutcome(completedCount: number, totalCount: number) {
  return useMemo(() => {
    if (totalCount === 0) {
      return {
        outcome: 'missed' as const,
        completionPct: 0,
        isExecuted: false,
      };
    }

    const completionPct = completedCount / totalCount;
    const isExecuted = completionPct === 1; // 100% required

    return {
      outcome: isExecuted ? ('executed' as const) : ('missed' as const),
      completionPct, // 0..1, for future cohort ranking
      isExecuted,
    };
  }, [completedCount, totalCount]);
}

