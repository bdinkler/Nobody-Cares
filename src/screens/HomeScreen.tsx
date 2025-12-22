import { useDailyOutcome } from '@/src/hooks/use-daily-outcome';
import { useRollingConsistency } from '@/src/hooks/use-rolling-consistency';
import { useTaskRestCredits } from '@/src/hooks/use-task-rest-credits';
import { useTodaysCompletions } from '@/src/hooks/use-todays-completions';
import { useTodaysRests } from '@/src/hooks/use-todays-rests';
import { useTodaysTasks } from '@/src/hooks/use-todays-tasks';
import { useVisionStatement } from '@/src/hooks/use-vision-statement';
import { getLocalDateYYYYMMDD } from '@/src/lib/date-utils';
import { isTaskEligibleForRest } from '@/src/lib/rest-utils';
import { supabase } from '@/src/lib/supabase';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function HomeScreen() {
  const { tasks, loading: tasksLoading, error: tasksError, refetch: refetchTasks } = useTodaysTasks();
  const { completedTaskIds, loading: completionsLoading, error: completionsError, refetch: refetchCompletions } = useTodaysCompletions();
  const { restedTaskIds, loading: restsLoading, error: restsError, refetch: refetchRests } = useTodaysRests();
  const { visionStatement } = useVisionStatement();
  const { completionPct: rollingCompletionPct, eligibleCount, completedCount, loading: consistencyLoading, refetch: refetchRollingConsistency } = useRollingConsistency();
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState(false);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [actionSheetTaskId, setActionSheetTaskId] = useState<string | null>(null);
  const [restConfirmModalVisible, setRestConfirmModalVisible] = useState(false);
  const [restingTask, setRestingTask] = useState(false);
  
  // Fetch rest credits for the task being rested (when actionSheetTaskId is set)
  const { credits: restCredits, loading: restCreditsLoading, refetch: refetchRestCredits } = useTaskRestCredits(actionSheetTaskId);

  // Centralized cleanup helper - resets all modal and pending state
  // Must be bulletproof and called in finally blocks
  const resetOverlays = () => {
    setConfirmModalVisible(false);
    setRestConfirmModalVisible(false);
    setActionSheetVisible(false);
    setPendingTaskId(null);
    setActionSheetTaskId(null);
    setCompletingTask(false);
    setRestingTask(false);
  };

  // Minimal dev logging for overlay visibility changes (only in development)
  useEffect(() => {
    if (__DEV__ && (confirmModalVisible || actionSheetVisible || restConfirmModalVisible)) {
      console.log('[HomeScreen overlays]', {
        confirmModalVisible,
        actionSheetVisible,
        restConfirmModalVisible,
      });
    }
  }, [confirmModalVisible, actionSheetVisible, restConfirmModalVisible]);

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
  // Exclude rested tasks from denominator
  const completionStats = useMemo(() => {
    // Filter out rested tasks
    const activeTasks = tasks.filter((task) => !restedTaskIds.has(task.id));
    const total = activeTasks.length;
    const completed = activeTasks.filter((task) => completedTaskIds.has(task.id)).length;
    return { completed, total };
  }, [tasks, completedTaskIds, restedTaskIds]);

  // Compute daily outcome and completionPct (for future cohort ranking)
  // completionPct is computed but not displayed - available for cohort ranking
  const { outcome, completionPct, isExecuted } = useDailyOutcome(
    completionStats.completed,
    completionStats.total
  );

  const handleTaskPress = (taskId: string) => {
    const isCompleted = completedTaskIds.has(taskId);
    const isRested = restedTaskIds.has(taskId);
    
    // If completed or rested, no action
    if (isCompleted || isRested) {
      return;
    }

    // Show confirmation modal before marking complete
    setPendingTaskId(taskId);
    setConfirmModalVisible(true);
  };

  const handleTaskLongPress = (taskId: string, taskTitle: string) => {
    const isCompleted = completedTaskIds.has(taskId);
    const isRested = restedTaskIds.has(taskId);
    
    // If completed or rested, no action (including no rest action)
    if (isCompleted || isRested) {
      return;
    }

    // Only show action sheet for eligible tasks that are not completed or rested
    if (isTaskEligibleForRest(taskTitle)) {
      setActionSheetTaskId(taskId);
      setActionSheetVisible(true);
    }
  };

  const confirmTaskCompletion = async () => {
    setCompletingTask(true);
    try {
      if (!pendingTaskId) {
        throw new Error('No pending task ID');
      }

      // Safety check: cannot complete if already rested
      if (restedTaskIds.has(pendingTaskId)) {
        Alert.alert('Cannot complete', 'This task is already rested.');
        throw new Error('Task already rested');
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('[HomeScreen] Error getting user:', authError);
        throw new Error('Failed to get user');
      }

      const today = getLocalDateYYYYMMDD();
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
      // Refetch rolling consistency after completion (optional polish)
      await refetchRollingConsistency();
    } catch (err) {
      console.error('[HomeScreen] Unexpected error completing task:', err);
    } finally {
      // ALWAYS cleanup state, regardless of success or failure
      resetOverlays();
    }
  };

  const cancelTaskCompletion = () => {
    resetOverlays();
  };

  const handleActionSheetComplete = () => {
    if (!actionSheetTaskId) return;
    setActionSheetVisible(false);
    setPendingTaskId(actionSheetTaskId);
    setActionSheetTaskId(null);
    setConfirmModalVisible(true);
  };

  const handleActionSheetRest = () => {
    // Close ActionSheet first
    setActionSheetVisible(false);
    // Fetch credits before showing modal
    refetchRestCredits();
    // Delay opening rest modal to avoid modal overlay conflicts
    // Use requestAnimationFrame for proper sequencing
    requestAnimationFrame(() => {
      setRestConfirmModalVisible(true);
    });
  };

  const cancelActionSheet = () => {
    resetOverlays();
  };

  const confirmTaskRest = async () => {
    const taskIdToRest = actionSheetTaskId;
    
    setRestingTask(true);
    try {
      if (!taskIdToRest) {
        throw new Error('No task ID to rest');
      }

      // Check if task is already completed or rested (shouldn't happen, but safety check)
      if (completedTaskIds.has(taskIdToRest)) {
        Alert.alert('Cannot rest', 'This task is already completed.');
        throw new Error('Task already completed');
      }

      if (restedTaskIds.has(taskIdToRest)) {
        Alert.alert('Already rested', 'This task is already rested today.');
        throw new Error('Task already rested');
      }

      // Call RPC function to enforce limits and insert rest server-side
      const payload = { p_task_id: taskIdToRest };
      const { data, error: rpcError } = await supabase.rpc('rest_task_today', payload);

      if (rpcError) {
        // Enhanced error logging with actionable details
        console.error('[HomeScreen] rest_task_today RPC Error:', {
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
          code: rpcError.code,
          payloadKeys: Object.keys(payload),
          payload: payload,
        });
        
        // Handle specific error messages from RPC
        const errorMessage = rpcError.message;
        if (errorMessage.includes('No rest credits remaining')) {
          Alert.alert('No rest credits remaining', 'No rest credits remaining for this task this month.');
        } else if (errorMessage.includes('already rested today') || errorMessage.includes('Task already rested today')) {
          // Unique constraint violation - treat as success and refresh
          console.log('[HomeScreen] Task already rested (unique constraint), refreshing...');
          await refetchRests();
          await refetchRestCredits();
          // Don't show error, just refresh and close
        } else if (errorMessage.includes('Rest not available')) {
          Alert.alert('Rest not available', 'Rest is not available for this task.');
        } else {
          Alert.alert('Error', errorMessage || 'Failed to rest task. Please try again.');
        }
      } else {
        // Success - refresh UI state
        await refetchRests();
        await refetchRestCredits();
        // Refetch rolling consistency after rest (optional polish)
        await refetchRollingConsistency();
      }
    } catch (err) {
      console.error('[HomeScreen] Unexpected error resting task:', err);
      // Only show alert if it's not already shown above
      if (err instanceof Error && !err.message.includes('already')) {
        Alert.alert('Error', 'Failed to rest task. Please try again.');
      }
    } finally {
      // ALWAYS cleanup UI state, regardless of success or failure
      resetOverlays();
    }
  };

  const cancelTaskRest = () => {
    resetOverlays();
  };

  const handleAddCommitments = () => {
    router.push('/(onboarding)/commitments');
  };

  const loading = tasksLoading || completionsLoading || restsLoading;
  const error = tasksError || completionsError || restsError;

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
              refetchRests();
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
                const isRested = restedTaskIds.has(task.id);
                const isEligibleForRest = isTaskEligibleForRest(task.title);
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[
                      styles.taskRow,
                      isCompleted && styles.taskRowCompleted,
                      isRested && styles.taskRowRested,
                      (isCompleted || isRested) && styles.taskRowDisabled,
                    ]}
                    onPress={() => handleTaskPress(task.id)}
                    onLongPress={() => handleTaskLongPress(task.id, task.title)}
                    activeOpacity={(isCompleted || isRested) ? 1 : 0.7}
                    disabled={isCompleted || isRested}>
                    <View style={styles.taskContent}>
                      <Text style={[
                        styles.taskTitle,
                        isCompleted && styles.taskTitleCompleted,
                        isRested && styles.taskTitleRested,
                      ]}>
                        {task.title}
                      </Text>
                      {task.duration_minutes && (
                        <Text style={styles.taskDuration}>{task.duration_minutes} min</Text>
                      )}
                      {isRested && (
                        <Text style={styles.restedLabel}>Rested today</Text>
                      )}
                    </View>
                    <View style={[
                      styles.checkbox,
                      isCompleted && styles.checkboxCompleted,
                      isRested && styles.checkboxRested,
                    ]}>
                      {isCompleted && <Text style={styles.checkmark}>✓</Text>}
                      {isRested && !isCompleted && (
                        <MaterialIcons name="bedtime" size={16} color="#888" />
                      )}
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
                    <Text style={styles.infoCardBodyPrimary}>
                      {consistencyLoading ? '—%' : `${Math.round(rollingCompletionPct)}%`} last 30 days
                    </Text>
                    <Text style={styles.infoCardBodySecondary}>
                      {consistencyLoading ? '—' : `${completedCount}/${eligibleCount}`} tasks completed
                    </Text>
                  </View>
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

      {/* Confirmation Modal - View-based overlay to avoid native Modal ghost overlay issues */}
      {confirmModalVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={cancelTaskCompletion}
          />
          <View style={styles.modalOverlay} pointerEvents="box-none">
            <View style={styles.modalContent} pointerEvents="auto">
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
        </View>
      )}

      {/* ActionSheet - View-based overlay to avoid native Modal ghost overlay issues */}
      {actionSheetVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (__DEV__) {
                console.log('[HomeScreen] ActionSheet overlay tapped');
              }
              cancelActionSheet();
            }}
          />
          <View style={styles.actionSheetOverlay} pointerEvents="box-none">
            <View style={styles.actionSheetContent} pointerEvents="auto">
              <TouchableOpacity
                style={styles.actionSheetOption}
                onPress={handleActionSheetComplete}>
                <Text style={styles.actionSheetOptionText}>Mark Complete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionSheetOption}
                onPress={handleActionSheetRest}>
                <Text style={styles.actionSheetOptionText}>Rest this task today</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionSheetOption, styles.actionSheetCancel]}
                onPress={cancelActionSheet}>
                <Text style={styles.actionSheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Rest Confirmation Modal - View-based overlay to avoid native Modal ghost overlay issues */}
      {restConfirmModalVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={cancelTaskRest}
          />
          <View style={styles.modalOverlay} pointerEvents="box-none">
            <View style={styles.modalContent} pointerEvents="auto">
              <Text style={styles.modalTitle}>Rest this task today?</Text>
              <Text style={styles.modalBody}>
                {restCreditsLoading ? (
                  'Loading rest credits...'
                ) : restCredits ? (
                  restCredits.limit === 0 ? (
                    'This task doesn\'t support rest.'
                  ) : restCredits.remaining === 0 ? (
                    'No rest credits remaining this month.'
                  ) : (
                    `You have ${restCredits.remaining} rest credit${restCredits.remaining === 1 ? '' : 's'} remaining this month for this task. Uses 1 rest credit. This task won't count against today.`
                  )
                ) : (
                  'Uses 1 rest credit. This task won\'t count against today.'
                )}
              </Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={cancelTaskRest}>
                  <Text style={styles.modalButtonCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonConfirm, (restingTask || restCreditsLoading || (restCredits && (restCredits.limit === 0 || restCredits.remaining === 0))) && styles.modalButtonDisabled]}
                  onPress={confirmTaskRest}
                  disabled={!!(restingTask || restCreditsLoading || (restCredits && (restCredits.limit === 0 || restCredits.remaining === 0)))}>
                  {restingTask ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.modalButtonConfirmText}>Rest</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}
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
  taskRowRested: {
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
  taskTitleRested: {
    color: '#888',
    fontStyle: 'italic',
  },
  taskDuration: {
    fontSize: 12,
    color: '#999',
  },
  restedLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    fontStyle: 'italic',
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
  checkboxRested: {
    borderColor: '#666',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
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
  actionSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
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
  actionSheetContent: {
    backgroundColor: '#111',
    borderRadius: 12,
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
    marginTop: 'auto',
    marginBottom: 40,
  },
  actionSheetOption: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  actionSheetOptionText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    fontWeight: '500',
  },
  actionSheetCancel: {
    borderBottomWidth: 0,
    backgroundColor: '#1a1a1a',
  },
  actionSheetCancelText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    fontWeight: '500',
  },
});
