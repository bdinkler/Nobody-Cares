import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, TextInput, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useOnboardingRefresh } from '@/src/contexts/onboarding-context';
import { ensureProfileTimezone } from '@/src/lib/timezone-utils';

export default function RulesScreen() {
  const [agreed, setAgreed] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading] = useState(false);
  const { refresh } = useOnboardingRefresh();

  // Validate first name: must be at least 2 characters after trimming
  const isFirstNameValid = firstName.trim().length >= 2;
  const canContinue = agreed && isFirstNameValid;

  const handleComplete = async () => {
    if (!agreed) {
      Alert.alert('Error', 'Please agree to the rules to continue');
      return;
    }
    if (!isFirstNameValid) {
      Alert.alert('Error', 'Please enter your first name (at least 2 characters)');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'User not found');
        setLoading(false);
        return;
      }

      // Ensure profile timezone is set from device (must happen before other profile updates)
      await ensureProfileTimezone();

      // Update profile with first_name using UPDATE (not upsert) to avoid RLS insert errors
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim(),
        })
        .eq('id', user.id);

      if (error) {
        Alert.alert('Error', error.message);
        setLoading(false);
        return;
      }

      // Refresh onboarding status to mark onboarding as complete
      refresh();
      // Navigate to paywall after onboarding is complete
      router.replace('/(paywall)');
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rules</Text>
      
      <View style={styles.rulesContainer}>
        <Text style={styles.ruleText}>• Be honest with yourself</Text>
        <Text style={styles.ruleText}>• Track your progress daily</Text>
        <Text style={styles.ruleText}>• Don't make excuses</Text>
        <Text style={styles.ruleText}>• Focus on consistency over perfection</Text>
        <Text style={styles.ruleText}>• Take ownership of your journey</Text>
      </View>

      {/* First Name Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>First Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your first name"
          placeholderTextColor="#666"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          editable={!loading}
        />
      </View>

      <TouchableOpacity
        style={styles.checkboxContainer}
        onPress={() => setAgreed(!agreed)}
      >
        <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
          {agreed && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkboxLabel}>I agree to these rules</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, !canContinue && styles.buttonDisabled]}
        onPress={handleComplete}
        disabled={!canContinue || loading}
      >
        {loading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.buttonText}>Accept & Continue</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 32,
  },
  rulesContainer: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 32,
  },
  ruleText: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 16,
    lineHeight: 24,
  },
  inputContainer: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontSize: 16,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#fff',
  },
  checkmark: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 16,
    color: '#fff',
  },
  button: {
    width: '100%',
    maxWidth: 400,
    height: 50,
    backgroundColor: '#fff',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
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

