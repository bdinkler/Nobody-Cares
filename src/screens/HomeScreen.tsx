import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import { useTodaysTasks } from '@/src/hooks/use-todays-tasks';
import { useTodaysCompletions } from '@/src/hooks/use-todays-completions';
import { useDailyOutcome } from '@/src/hooks/use-daily-outcome';
import { useVisionStatement } from '@/src/hooks/use-vision-statement';
import { supabase } from '@/src/lib/supabase';
import { getTodayISODate } from '@/src/lib/date-utils';

export default function HomeScreen() {
  const { tasks, loading: tasksLoading, error: tasksError, refetch: refetchTasks } = useTodaysTasks();
  const { completedTaskIds, loading: completionsLoading, error: completionsError, refetch: refetchCompletions } = useTodaysCompletions();
  const { visionStatement } = useVisionStatement();
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState(false);

  // Helper to truncate text to ~140-160 characters
  const truncateText = (text: string, maxLength: number = 150): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  };

  // Get today's date string
  const todayDate = useMemo(() => {
    const today = new Date();
    return today.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  // Calculate completion stats from Supabase data
  const completionStats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((task) => completedTaskIds.has(task.id)).length;
    return { completed, total };
  }, [tasks, completedTaskIds]);

  // Compute daily outcome and completionPct (for future cohort ranking)
  // completionPct is computed but not displayed - available for cohort ranking
  const { outcome, completionPct, isExecuted } = useDailyOutcome(
    completionStats.completed,
    completionStats.total
  );

  const handleTaskPress = (taskId: string) => {
    const isCompleted = completedTaskIds.has(taskId);
    
    // Stricter approach: Once completed, cannot be undone from Home screen
    if (isCompleted) {
      return; // Disabled - no action
    }

    // Show confirmation modal before marking complete
    setPendingTaskId(taskId);
    setConfirmModalVisible(true);
  };

  const confirmTaskCompletion = async () => {
    if (!pendingTaskId) {
      setConfirmModalVisible(false);
      setPendingTaskId(null);
      return;
    }

    setCompletingTask(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('[HomeScreen] Error getting user:', authError);
        setConfirmModalVisible(false);
        setPendingTaskId(null);
        setCompletingTask(false);
        return;
      }

      const today = getTodayISODate();
      const { error: insertError } = await supabase
        .from('task_completions')
        .insert({
          user_id: user.id,
          task_id: pendingTaskId,
          completed_on: today,
        });

      // Handle unique constraint gracefully - if already exists, treat as success
      if (insertError) {
        // Check if error is due to unique constraint violation
        if (insertError.code === '23505' || insertError.message.includes('unique')) {
          // Already completed, treat as success
          console.log('[HomeScreen] Task already completed, refreshing...');
        } else {
          console.error('[HomeScreen] Error inserting completion:', insertError);
          // Still refresh to sync state
        }
      }

      // Refresh completions to update UI (optimistic update alternative would work too)
      await refetchCompletions();
    } catch (err) {
      console.error('[HomeScreen] Unexpected error completing task:', err);
    } finally {
      setCompletingTask(false);
      setConfirmModalVisible(false);
      setPendingTaskId(null);
    }
  };

  const cancelTaskCompletion = () => {
    setConfirmModalVisible(false);
    setPendingTaskId(null);
  };

  const handleAddCommitments = () => {
    router.push('/(onboarding)/commitments');
  };

  const loading = tasksLoading || completionsLoading;
  const error = tasksError || completionsError;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.contentContainer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Today</Text>
            <Text style={styles.dateText}>{todayDate}</Text>
          </View>
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => {
              refetchTasks();
              refetchCompletions();
            }}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Today</Text>
          <Text style={styles.dateText}>{todayDate}</Text>
        </View>

        {/* Microcopy */}
        <Text style={styles.microcopy}>Do the work. Log it.</Text>

        {/* Streak / Consistency Summary */}
        <View style={styles.summaryContainer}>
          <Text style={styles.summaryText}>
            Completed {completionStats.completed} / {completionStats.total} today
          </Text>
        </View>

        {/* Tasks List */}
        {tasks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No commitments found. Go add at least one.</Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddCommitments}>
              <Text style={styles.addButtonText}>Add Commitments</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.tasksContainer}>
              {tasks.map((task) => {
                const isCompleted = completedTaskIds.has(task.id);
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[
                      styles.taskRow,
                      isCompleted && styles.taskRowCompleted,
                      isCompleted && styles.taskRowDisabled,
                    ]}
                    onPress={() => handleTaskPress(task.id)}
                    activeOpacity={isCompleted ? 1 : 0.7}
                    disabled={isCompleted}>
                    <View style={styles.taskContent}>
                      <Text style={[styles.taskTitle, isCompleted && styles.taskTitleCompleted]}>
                        {task.title}
                      </Text>
                      {task.duration_minutes && (
                        <Text style={styles.taskDuration}>{task.duration_minutes} min</Text>
                      )}
                    </View>
                    <View style={[styles.checkbox, isCompleted && styles.checkboxCompleted]}>
                      {isCompleted && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Outcome State Message - Only show positive message when 100% complete */}
            {tasks.length > 0 && isExecuted && (
              <View style={styles.outcomeContainer}>
                <Text style={styles.outcomeMessageExecuted}>
                  Goals aren't won in a singular day, they're won through consistency. Keep it up.
                </Text>
              </View>
            )}

            {/* Info Cards Row */}
            {tasks.length > 0 && (
              <View style={styles.infoCardsRow}>
                {/* Your 12-Month Outcome card */}
                <View style={styles.infoCard}>
                  <Text style={styles.infoCardTitle}>Your 12-Month Outcome</Text>
                  <Text style={styles.infoCardBody} numberOfLines={4}>
                    {visionStatement
                      ? truncateText(visionStatement)
                      : 'Set your 12-month outcome in onboarding.'}
                  </Text>
                </View>

                {/* Consistency card */}
                <View style={styles.infoCardConsistency}>
                  <View style={styles.infoCardConsistencyContent}>
                    <Text style={styles.infoCardTitle}>Consistency</Text>
                    <Text style={styles.infoCardBodyPrimary}>0% this month</Text>
                    {/* TODO: Replace with real monthly completion once we store task logs */}
                  </View>
                  <Text style={styles.infoCardBodySecondary}>
                    Cohorts are ranked by completion %
                  </Text>
                </View>
              </View>
            )}

            {/* Midnight Helper Line */}
            {tasks.length > 0 && (
              <Text style={styles.midnightHelper}>
                Uncompleted tasks are logged as missed at midnight.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Confirmation Modal */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelTaskCompletion}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Mark as complete?</Text>
            <Text style={styles.modalBody}>This locks for today.</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={cancelTaskCompletion}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm, completingTask && styles.modalButtonDisabled]}
                onPress={confirmTaskCompletion}
                disabled={completingTask}>
                {completingTask ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  dateText: {
    fontSize: 16,
    color: '#999',
  },
  microcopy: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    fontStyle: 'italic',
  },
  summaryContainer: {
    marginBottom: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  summaryText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '600',
  },
  tasksContainer: {
    gap: 12,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  taskRowCompleted: {
    backgroundColor: '#1a1a1a',
    borderColor: '#444',
    opacity: 0.7,
  },
  taskContent: {
    flex: 1,
    marginRight: 12,
  },
  taskTitle: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
    marginBottom: 4,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#666',
  },
  taskDuration: {
    fontSize: 12,
    color: '#999',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCompleted: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  checkmark: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  addButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontSize: 14,
    color: '#ff4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#333',
    borderRadius: 6,
  },
  retryButtonText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  outcomeContainer: {
    marginTop: 24,
    marginBottom: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  outcomeMessageExecuted: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 22,
    textAlign: 'center',
  },
  midnightHelper: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  taskRowDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 15,
    color: '#999',
    marginBottom: 24,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#333',
  },
  modalButtonConfirm: {
    backgroundColor: '#fff',
  },
  modalButtonCancelText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  modalButtonConfirmText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  infoCardsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 36,
    marginBottom: 16,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  infoCardConsistency: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'space-between',
  },
  infoCardConsistencyContent: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  infoCardBody: {
    fontSize: 13,
    color: '#ccc',
    lineHeight: 18,
  },
  infoCardBodyPrimary: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 4,
  },
  infoCardBodySecondary: {
    fontSize: 10,
    color: '#666',
    lineHeight: 14,
    marginTop: 8,
  },
});
