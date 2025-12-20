import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useOnboardingRefresh } from '@/src/contexts/onboarding-context';

export default function VisionScreen() {
  const [vision, setVision] = useState('');
  const [loading, setLoading] = useState(false);
  const { refresh } = useOnboardingRefresh();

  const handleNext = async () => {
    if (!vision.trim()) {
      Alert.alert('Error', 'Please enter your vision statement');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'User not found');
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          vision_statement: vision.trim(),
          vision_created_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        // Refresh onboarding status, then navigate
        refresh();
        router.push('/(onboarding)/commitments');
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Vision</Text>
      <Text style={styles.subtitle}>In 12 months, what does success look like for you?</Text>
      <Text style={styles.subtext}>Be specific. This is the standard you'll hold yourself to.</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Describe where you want to be one year from now."
        placeholderTextColor="#666"
        value={vision}
        onChangeText={setVision}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        editable={!loading}
      />

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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    maxWidth: 400,
    minHeight: 120,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 24,
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

