import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { useTasks } from '@/src/hooks/use-tasks';
import { Task } from '@/src/hooks/use-tasks';

// Preset tasks with default durations
const PRESET_TASKS = [
  { name: 'Workout', duration: 45, requiresDuration: true },
  { name: 'Deep Work', duration: 60, requiresDuration: true },
  { name: 'Read', duration: 20, requiresDuration: false },
  { name: 'Cold Shower', duration: null, requiresDuration: false },
  { name: 'Reset Space', duration: null, requiresDuration: false },
  { name: 'Write in Journal', duration: null, requiresDuration: false },
  { name: 'Meditate', duration: null, requiresDuration: false },
];

// Normalize function for case-insensitive, trimmed comparison
const normalize = (s: string): string => s.trim().toLowerCase();

export default function ManageTasksScreen() {
  const { tasks, loading, error, refetch, addTask, updateTask, deactivateTask } = useTasks();
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [customDuration, setCustomDuration] = useState('');
  const [editName, setEditName] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [saving, setSaving] = useState(false);

  // Filter Quick Add options to exclude already active tasks
  const activeNames = new Set(tasks.map(t => normalize(t.title)));
  const quickAddOptions = PRESET_TASKS.filter(opt => !activeNames.has(normalize(opt.name)));

  const handleAddTask = () => {
    setSelectedPreset(null);
    setCustomName('');
    setCustomDuration('');
    setAddModalVisible(true);
  };

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setEditName(task.title);
    setEditDuration(task.duration_minutes?.toString() || '');
    setEditModalVisible(true);
  };

  const handleRemoveTask = (task: Task) => {
    Alert.alert(
      'Remove Task',
      `Remove "${task.title}" from your active tasks? This won't delete your completion history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deactivateTask(task.id);
            } catch (err) {
              Alert.alert('Error', 'Failed to remove task. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handlePresetSelect = (preset: typeof PRESET_TASKS[0]) => {
    setSelectedPreset(preset.name);
    setCustomName('');
    setCustomDuration(preset.duration?.toString() || '');
  };

  const handleSaveAdd = async () => {
    if (selectedPreset) {
      const preset = PRESET_TASKS.find(p => p.name === selectedPreset);
      if (!preset) return;

      setSaving(true);
      try {
        await addTask({
          name: preset.name,
          duration_minutes: preset.requiresDuration && preset.duration ? preset.duration : (customDuration ? parseInt(customDuration, 10) : null),
        });
        setAddModalVisible(false);
        setSelectedPreset(null);
        setCustomName('');
        setCustomDuration('');
      } catch (err) {
        Alert.alert('Error', 'Failed to add task. Please try again.');
      } finally {
        setSaving(false);
      }
    } else if (customName.trim()) {
      setSaving(true);
      try {
        await addTask({
          name: customName.trim(),
          duration_minutes: customDuration ? parseInt(customDuration, 10) : null,
        });
        setAddModalVisible(false);
        setCustomName('');
        setCustomDuration('');
      } catch (err) {
        Alert.alert('Error', 'Failed to add task. Please try again.');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!editingTask || !editName.trim()) return;

    setSaving(true);
    try {
      await updateTask(editingTask.id, {
        name: editName.trim(),
        duration_minutes: editDuration ? parseInt(editDuration, 10) : null,
      });
      setEditModalVisible(false);
      setEditingTask(null);
      setEditName('');
      setEditDuration('');
    } catch (err) {
      Alert.alert('Error', 'Failed to update task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelAdd = () => {
    setAddModalVisible(false);
    setSelectedPreset(null);
    setCustomName('');
    setCustomDuration('');
  };

  const handleCancelEdit = () => {
    setEditModalVisible(false);
    setEditingTask(null);
    setEditName('');
    setEditDuration('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            activeOpacity={0.7}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manage Tasks</Text>
        </View>

        {/* Error State */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refetch}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Loading State */}
        {loading && !error && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}

        {/* Active Tasks List */}
        {!loading && !error && (
          <>
            {tasks.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No active tasks yet.</Text>
                <Text style={styles.emptySubtext}>Add your first commitment.</Text>
              </View>
            ) : (
              <View style={styles.tasksContainer}>
                {tasks.map((task) => (
                  <TouchableOpacity
                    key={task.id}
                    style={styles.taskRow}
                    onPress={() => handleEditTask(task)}
                    onLongPress={() => handleRemoveTask(task)}
                    activeOpacity={0.7}>
                    <View style={styles.taskContent}>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      {task.duration_minutes && (
                        <Text style={styles.taskDuration}>{task.duration_minutes} min</Text>
                      )}
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Add Task Button */}
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddTask}
              activeOpacity={0.8}>
              <Text style={styles.addButtonText}>Add Task</Text>
            </TouchableOpacity>
            <Text style={styles.addTaskNote}>New tasks begin tracking tomorrow.</Text>

            {/* Rest Explanation Card */}
            <View style={styles.restCard}>
              <Text style={styles.restCardTitle}>How Rest Works</Text>
              <Text style={styles.restCardBody}>
                Certain commitments require recovery. Rest days are built in so you can stay consistent without burning out.
              </Text>
              <Text style={styles.restCardBody}>
                You receive limited rest credits each month for demanding tasks (Workout: 4/month, Deep Work: 8/month).
              </Text>
              <Text style={styles.restCardBody}>
                Use them when rest is necessary — not as a way out, but as a way back.
              </Text>
              <Text style={styles.restCardBody}>
                Rest protects momentum. It does not replace execution.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Add Task Modal */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCancelAdd}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Task</Text>

            {/* Preset Tasks */}
            {quickAddOptions.length > 0 ? (
              <View style={styles.presetsContainer}>
                <Text style={styles.sectionLabel}>Quick Add</Text>
                <ScrollView style={styles.presetsList} nestedScrollEnabled>
                  {quickAddOptions.map((preset) => (
                    <TouchableOpacity
                      key={preset.name}
                      style={[
                        styles.presetItem,
                        selectedPreset === preset.name && styles.presetItemSelected,
                      ]}
                      onPress={() => handlePresetSelect(preset)}
                      activeOpacity={0.7}>
                      <Text style={[
                        styles.presetItemText,
                        selectedPreset === preset.name && styles.presetItemTextSelected,
                      ]}>
                        {preset.name}
                        {preset.duration && ` (${preset.duration} min)`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.presetsContainer}>
                <Text style={styles.noSuggestionsText}>No suggestions right now</Text>
              </View>
            )}

            {/* Custom Task */}
            <View style={styles.customContainer}>
              <Text style={styles.sectionLabel}>Custom Task</Text>
              <TextInput
                style={styles.input}
                placeholder="Task name"
                placeholderTextColor="#666"
                value={customName}
                onChangeText={(text) => {
                  setCustomName(text);
                  setSelectedPreset(null);
                }}
                autoCapitalize="words"
              />
              <TextInput
                style={styles.input}
                placeholder="Duration (minutes, optional)"
                placeholderTextColor="#666"
                value={customDuration}
                onChangeText={setCustomDuration}
                keyboardType="numeric"
              />
            </View>

            {/* Duration Override for Selected Preset */}
            {selectedPreset && (
              <View style={styles.durationOverride}>
                <Text style={styles.sectionLabel}>Override Duration (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Duration in minutes"
                  placeholderTextColor="#666"
                  value={customDuration}
                  onChangeText={setCustomDuration}
                  keyboardType="numeric"
                />
              </View>
            )}

            {/* Modal Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCancelAdd}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonConfirm,
                  saving && styles.modalButtonDisabled,
                ]}
                onPress={handleSaveAdd}
                disabled={saving || (!selectedPreset && !customName.trim())}>
                {saving ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCancelEdit}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Task</Text>

            <TextInput
              style={styles.input}
              placeholder="Task name"
              placeholderTextColor="#666"
              value={editName}
              onChangeText={setEditName}
              autoCapitalize="words"
            />

            <TextInput
              style={styles.input}
              placeholder="Duration (minutes, optional)"
              placeholderTextColor="#666"
              value={editDuration}
              onChangeText={setEditDuration}
              keyboardType="numeric"
            />

            {/* Remove Button */}
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => {
                if (editingTask) {
                  setEditModalVisible(false);
                  handleRemoveTask(editingTask);
                }
              }}>
              <Text style={styles.removeButtonText}>Remove Task</Text>
            </TouchableOpacity>

            {/* Modal Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCancelEdit}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonConfirm,
                  saving && styles.modalButtonDisabled,
                ]}
                onPress={handleSaveEdit}
                disabled={saving || !editName.trim()}>
                {saving ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Save</Text>
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
  header: {
    marginBottom: 24,
  },
  backButton: {
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  tasksContainer: {
    gap: 12,
    marginBottom: 24,
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
  taskDuration: {
    fontSize: 12,
    color: '#999',
  },
  chevron: {
    fontSize: 24,
    color: '#666',
    fontWeight: '300',
  },
  addButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  addButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  addTaskNote: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    fontStyle: 'italic',
  },
  restCard: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  restCardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  restCardBody: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
    marginBottom: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 24,
  },
  presetsContainer: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    marginBottom: 12,
  },
  noSuggestionsText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  presetsList: {
    maxHeight: 200,
  },
  presetItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  presetItemSelected: {
    backgroundColor: '#333',
    borderColor: '#666',
  },
  presetItemText: {
    fontSize: 16,
    color: '#fff',
  },
  presetItemTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  customContainer: {
    marginBottom: 24,
  },
  durationOverride: {
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  removeButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#2a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff4444',
    alignItems: 'center',
    marginBottom: 24,
  },
  removeButtonText: {
    fontSize: 16,
    color: '#ff4444',
    fontWeight: '600',
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
});
