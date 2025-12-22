import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, TextInput, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useOnboardingRefresh } from '@/src/contexts/onboarding-context';

// Preset commitments - in exact order
const PRESET_COMMITMENTS = [
  'Workout',
  'Deep Work',
  'Read',
  'Meditate',
  'Write in Journal',
  'Cold Shower',
  'No Social Media Before Noon',
  'Cook at Home',
  'Plan Tomorrow',
  'Reset Space',
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const DEFAULT_DURATION = 60;
const DEFAULT_READ_DURATION = 30;

// Commitments that support duration
const DURATION_COMMITMENTS = ['Workout', 'Deep Work', 'Read'];

// Commitments that support rest credits with their monthly limits
const REST_LIMITS: Record<string, number> = {
  'Workout': 4,
  'Deep Work': 8,
};

export default function CommitmentsScreen() {
  const [selected, setSelected] = useState<string[]>([]);
  const [customCommitments, setCustomCommitments] = useState<string[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({
    'Workout': DEFAULT_DURATION,
    'Deep Work': DEFAULT_DURATION,
    'Read': DEFAULT_READ_DURATION,
  });
  const [customInput, setCustomInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { refresh } = useOnboardingRefresh();

  const allCommitments = [...PRESET_COMMITMENTS, ...customCommitments];

  const toggleCommitment = (commitment: string) => {
    setSelected((prev) =>
      prev.includes(commitment)
        ? prev.filter((c) => c !== commitment)
        : [...prev, commitment]
    );
  };

  const handleAddCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed) {
      return;
    }

    // Check for duplicates (case-insensitive) across both presets and custom
    const normalized = trimmed.toLowerCase();
    const isDuplicate = allCommitments.some(
      (c) => c.toLowerCase() === normalized
    );

    if (isDuplicate) {
      Alert.alert('Error', 'That commitment already exists.');
      return;
    }

    // Add to custom commitments and select it
    setCustomCommitments((prev) => [...prev, trimmed]);
    setSelected((prev) => [...prev, trimmed]);
    setCustomInput('');
  };

  const handleDurationChange = (commitment: string, duration: number) => {
    setDurations((prev) => ({
      ...prev,
      [commitment]: duration,
    }));
  };

  const handleNext = async () => {
    if (selected.length === 0) {
      Alert.alert('Error', 'Please select at least one commitment');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'User not found');
        return;
      }

      // Create tasks for selected commitments with durations and rest limits
      const tasks = selected.map((commitment) => {
        const task: any = {
          user_id: user.id,
          title: commitment,
          is_active: true,
        };

        // Add duration if this commitment supports it
        if (DURATION_COMMITMENTS.includes(commitment) && durations[commitment]) {
          task.duration_minutes = durations[commitment];
        }

        // Add rest_limit_per_month if this commitment has a rest limit
        if (REST_LIMITS[commitment] !== undefined) {
          task.rest_limit_per_month = REST_LIMITS[commitment];
        }

        return task;
      });

      const { error } = await supabase.from('tasks').insert(tasks);

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        // Refresh onboarding status, then navigate
        refresh();
        router.push('/(onboarding)/rules');
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const renderCommitmentItem = (
    commitment: string,
    isSelected: boolean,
    showDuration: boolean = false
  ) => {
    const supportsDuration = DURATION_COMMITMENTS.includes(commitment);
    const defaultDuration = commitment === 'Read' ? DEFAULT_READ_DURATION : DEFAULT_DURATION;
    const duration = durations[commitment] || defaultDuration;

    return (
      <View key={commitment} style={styles.commitmentWrapper}>
        <TouchableOpacity
          style={[styles.commitmentItem, isSelected && styles.commitmentItemSelected]}
          onPress={() => toggleCommitment(commitment)}
        >
          <View style={styles.commitmentContent}>
            <Text style={[styles.commitmentText, isSelected && styles.commitmentTextSelected]}>
              {commitment}
            </Text>
            {isSelected && (
              <View style={styles.selectedBadge}>
                <Text style={styles.selectedBadgeText}>✓</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Duration selector for Workout/Deep Work/Read - show when selected and showDuration is true */}
        {isSelected && supportsDuration && showDuration && (
          <View style={styles.durationContainer}>
            <Text style={styles.durationLabel}>Duration (minutes):</Text>
            <View style={styles.durationOptions}>
              {DURATION_OPTIONS.map((mins) => (
                <TouchableOpacity
                  key={mins}
                  style={[
                    styles.durationOption,
                    duration === mins && styles.durationOptionSelected,
                  ]}
                  onPress={() => handleDurationChange(commitment, mins)}
                >
                  <Text
                    style={[
                      styles.durationOptionText,
                      duration === mins && styles.durationOptionTextSelected,
                    ]}
                  >
                    {mins}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Your Commitments</Text>
        <Text style={styles.subtitle}>Select at least one commitment to get started</Text>

        {/* Custom input */}
        <View style={styles.customInputContainer}>
          <TextInput
            style={styles.customInput}
            placeholder="Create a custom commitment…"
            placeholderTextColor="#666"
            value={customInput}
            onChangeText={setCustomInput}
            editable={!loading}
            onSubmitEditing={handleAddCustom}
          />
          <TouchableOpacity
            style={[styles.addButton, !customInput.trim() && styles.addButtonDisabled]}
            onPress={handleAddCustom}
            disabled={!customInput.trim() || loading}
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Selected Section */}
          {selected.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Selected</Text>
              {selected.map((commitment) => {
                return renderCommitmentItem(commitment, true, true);
              })}
            </View>
          )}

          {/* Pick More Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pick More</Text>
            {allCommitments
              .filter((commitment) => !selected.includes(commitment))
              .map((commitment) => {
                return renderCommitmentItem(commitment, false, false);
              })}
          </View>
        </ScrollView>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
    paddingTop: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },
  customInputContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 8,
  },
  customInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 16,
  },
  addButton: {
    height: 44,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  commitmentWrapper: {
    marginBottom: 12,
  },
  commitmentItem: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
  },
  commitmentItemSelected: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  commitmentContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commitmentText: {
    fontSize: 16,
    color: '#fff',
    flex: 1,
  },
  commitmentTextSelected: {
    color: '#000',
    fontWeight: '600',
  },
  selectedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  selectedBadgeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  durationContainer: {
    marginTop: 8,
    paddingLeft: 16,
  },
  durationLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  durationOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
  },
  durationOptionSelected: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  durationOptionText: {
    fontSize: 14,
    color: '#fff',
  },
  durationOptionTextSelected: {
    color: '#000',
    fontWeight: '600',
  },
  button: {
    width: '100%',
    maxWidth: 400,
    height: 50,
    backgroundColor: '#fff',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
});
