import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useProfile } from '@/src/hooks/use-profile';

export default function NewPostScreen() {
  const { firstName, avatarUrl } = useProfile();
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!content.trim()) {
      return;
    }

    setPosting(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('[NewPostScreen] Error getting user:', authError);
        setPosting(false);
        return;
      }

      const { error: insertError } = await supabase.from('posts').insert({
        author_id: user.id,
        body: content.trim(),
        scope: 'global',
      });

      if (insertError) {
        console.error('[NewPostScreen] Error inserting post:', insertError);
        setPosting(false);
        return;
      }

      // Navigate back - this will trigger refetch via useFocusEffect
      router.back();
    } catch (err) {
      console.error('[NewPostScreen] Unexpected error:', err);
      setPosting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}>
        <View style={styles.content}>
          <TextInput
            style={styles.textInput}
            placeholder="What's on your mind?"
            placeholderTextColor="#666"
            value={content}
            onChangeText={setContent}
            multiline
            autoFocus
            maxLength={5000}
          />
          <View style={styles.footer}>
            <Text style={styles.characterCount}>
              {content.length}/5000
            </Text>
            <TouchableOpacity
              style={[
                styles.postButton,
                (!content.trim() || posting) && styles.postButtonDisabled,
              ]}
              onPress={handlePost}
              disabled={!content.trim() || posting}>
              {posting ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={styles.postButtonText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  characterCount: {
    fontSize: 12,
    color: '#666',
  },
  postButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  postButtonDisabled: {
    opacity: 0.5,
  },
  postButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
});

