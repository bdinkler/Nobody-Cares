import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';

export default function FeedbackScreen() {
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmedFeedback = feedback.trim();
    
    if (!trimmedFeedback) {
      Alert.alert('Error', 'Please enter your feedback before submitting.');
      return;
    }

    if (trimmedFeedback.length < 10) {
      Alert.alert('Error', 'Please provide more detailed feedback (at least 10 characters).');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        Alert.alert('Error', 'User not found');
        setSubmitting(false);
        return;
      }

      const { error: insertError } = await supabase
        .from('feedback')
        .insert({
          user_id: user.id,
          feedback_text: trimmedFeedback,
        });

      if (insertError) {
        console.error('[Feedback] Submit error:', insertError);
        Alert.alert('Error', insertError.message || 'Failed to submit feedback. Please try again.');
        setSubmitting(false);
        return;
      }

      // Success - clear form and show confirmation
      setFeedback('');
      Alert.alert(
        'Thank you!',
        'Your feedback has been submitted. We appreciate your input!',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      console.error('[Feedback] Unexpected error:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
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
          <Text style={styles.headerTitle}>Feedback</Text>
        </View>

        {/* Instructions */}
        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionsText}>
            Share your thoughts and suggestions to help us improve the app.
          </Text>
        </View>

        {/* Feedback Input */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Please share your feedback, suggestions, or report any issues you've encountered..."
            placeholderTextColor="#666"
            value={feedback}
            onChangeText={setFeedback}
            multiline
            numberOfLines={12}
            textAlignVertical="top"
            editable={!submitting}
            maxLength={5000}
          />
          <Text style={styles.characterCount}>
            {feedback.length} / 5000
          </Text>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, (!feedback.trim() || submitting) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!feedback.trim() || submitting}
          activeOpacity={0.8}>
          {submitting ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.submitButtonText}>Submit Feedback</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
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
  instructionsContainer: {
    marginBottom: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  instructionsText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 24,
  },
  textInput: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    minHeight: 200,
    marginBottom: 8,
  },
  characterCount: {
    fontSize: 12,
    color: '#666',
    textAlign: 'right',
    paddingRight: 4,
  },
  submitButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
});
