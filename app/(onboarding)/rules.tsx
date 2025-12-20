import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useOnboardingRefresh } from '@/src/contexts/onboarding-context';

export default function RulesScreen() {
  const [agreed, setAgreed] = useState(false);
  const { refresh } = useOnboardingRefresh();

  const handleComplete = async () => {
    if (!agreed) {
      Alert.alert('Error', 'Please agree to the rules to continue');
      return;
    }
    // Refresh onboarding status to mark onboarding as complete
    refresh();
    // Navigate to paywall after onboarding is complete
    router.replace('/(paywall)');
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
        style={[styles.button, !agreed && styles.buttonDisabled]}
        onPress={handleComplete}
        disabled={!agreed}
      >
        <Text style={styles.buttonText}>Enter App</Text>
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

