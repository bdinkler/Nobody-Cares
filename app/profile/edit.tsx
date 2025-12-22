import React, { useState, useEffect } from 'react';
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
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';
import { useProfile } from '@/src/hooks/use-profile';

const NOTIFICATIONS_KEY = '@profile:notifications_enabled';

// Safe image picker import with graceful fallback
let ImagePicker: any = null;
try {
  ImagePicker = require('expo-image-picker');
} catch (e) {
  // ImagePicker not available
}

export default function EditProfileScreen() {
  const { firstName: initialFirstName, email, phone: initialPhone, avatarUrl, loading: profileLoading, refetch } = useProfile();
  
  // Form state
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  
  // UI state
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  // Load initial values and notifications preference
  useEffect(() => {
    if (!profileLoading) {
      setFirstName(initialFirstName || '');
      setPhone(initialPhone || '');
    }
  }, [initialFirstName, initialPhone, profileLoading]);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const value = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
        setNotificationsEnabled(value === 'true');
      } catch (error) {
        console.error('[EditProfile] Error loading notifications preference:', error);
      } finally {
        setLoadingNotifications(false);
      }
    };
    loadNotifications();
  }, []);

  // Check if there are unsaved changes
  const hasChanges = 
    firstName !== (initialFirstName || '') ||
    phone !== (initialPhone || '');

  const getInitials = (name: string | null): string => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const handleChangePhoto = async () => {
    if (!ImagePicker) {
      Alert.alert(
        'Photo upload unavailable',
        'Photo upload isn\'t available in this build yet. Please rebuild the app with expo-image-picker installed.'
      );
      return;
    }

    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera roll permissions to upload photos.');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const imageUri = result.assets[0].uri;
      if (!imageUri) {
        return;
      }

      setUploading(true);

      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        Alert.alert('Error', 'User not found');
        setUploading(false);
        return;
      }

      try {
        // Generate file path: avatars/{user_id}/{timestamp}.jpg
        const timestamp = Date.now();
        const filePath = `${user.id}/${timestamp}.jpg`;

        // Convert image to blob
        const response = await fetch(imageUri);
        const blob = await response.blob();

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          // Check if bucket doesn't exist or storage isn't set up
          if (uploadError.message?.includes('not found') || uploadError.message?.includes('bucket')) {
            Alert.alert(
              'Storage not configured',
              'Avatar storage isn\'t set up yet. Please configure the avatars bucket in Supabase Storage.'
            );
            setUploading(false);
            return;
          }
          throw uploadError;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        // Update profile with new avatar URL
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_url: publicUrl })
          .eq('id', user.id);

        if (updateError) {
          throw updateError;
        }

        // Success - refresh profile data
        await refetch();
      } catch (error: any) {
        console.error('[EditProfile] Upload error:', error);
        Alert.alert('Error', error.message || 'Failed to upload image. Please try again.');
      } finally {
        setUploading(false);
      }
    } catch (error: any) {
      console.error('[EditProfile] Unexpected error:', error);
      Alert.alert('Error', 'An unexpected error occurred');
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              const { data: { user }, error: authError } = await supabase.auth.getUser();
              if (authError || !user) {
                Alert.alert('Error', 'User not found');
                setRemoving(false);
                return;
              }

              // Update profile to remove avatar_url
              const { error: updateError } = await supabase
                .from('profiles')
                .update({ avatar_url: null })
                .eq('id', user.id);

              if (updateError) {
                Alert.alert('Error', updateError.message || 'Failed to remove photo');
                setRemoving(false);
                return;
              }

              // Success - refresh profile data
              await refetch();
            } catch (error) {
              console.error('[EditProfile] Unexpected error:', error);
              Alert.alert('Error', 'An unexpected error occurred');
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    setSaving(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        Alert.alert('Error', 'User not found');
        setSaving(false);
        return;
      }

      // Validate phone (basic: digits, +, max 20 chars)
      const phoneValue = phone.trim();
      if (phoneValue && !/^[+\d\s\-()]{1,20}$/.test(phoneValue)) {
        Alert.alert('Invalid phone number', 'Please enter a valid phone number (max 20 characters, digits and + only)');
        setSaving(false);
        return;
      }

      // Update profile - use UPDATE (not upsert) to avoid RLS insert errors
      // Profiles row should already exist from signup/onboarding
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim() || null,
          phone: phoneValue || null,
        })
        .eq('id', user.id);

      if (updateError) {
        Alert.alert('Error', updateError.message || 'Failed to save profile');
        setSaving(false);
        return;
      }

      // Success - refresh profile data
      await refetch();
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      console.error('[EditProfile] Unexpected error:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationsToggle = async (value: boolean) => {
    setNotificationsEnabled(value);
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_KEY, value ? 'true' : 'false');
    } catch (error) {
      console.error('[EditProfile] Error saving notifications preference:', error);
      // Revert on error
      setNotificationsEnabled(!value);
      Alert.alert('Error', 'Failed to save notification preference');
    }
  };

  const handleDeleteAccount = async () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            // Note: User account deletion requires admin privileges or an RPC function
            // For MVP, we'll show instructions to contact support
            Alert.alert(
              'Account Deletion',
              'To delete your account, please contact support or use the Supabase Dashboard. Account deletion requires admin privileges for security reasons.',
              [{ text: 'OK' }]
            );
          },
        },
      ]
    );
  };

  if (profileLoading || loadingNotifications) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaView>
    );
  }

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
          <Text style={styles.headerTitle}>Edit Profile</Text>
        </View>

        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(firstName)}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.changePhotoButton}
            onPress={handleChangePhoto}
            disabled={uploading || removing}>
            {uploading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.changePhotoButtonText}>Change photo</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Form Fields */}
        <View style={styles.formSection}>
          {/* Name */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your name"
              placeholderTextColor="#666"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
          </View>

          {/* Email (Read-only) */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Email</Text>
            <View style={styles.readOnlyInput}>
              <Text style={styles.readOnlyText}>{email || 'Not set'}</Text>
            </View>
          </View>

          {/* Phone */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Phone Number (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="+1 234 567 8900"
              placeholderTextColor="#666"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={20}
            />
          </View>

          {/* Notifications Toggle */}
          <View style={styles.fieldContainer}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLabelContainer}>
                <Text style={styles.fieldLabel}>Notifications</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationsToggle}
                trackColor={{ false: '#333', true: '#666' }}
                thumbColor={notificationsEnabled ? '#fff' : '#999'}
              />
            </View>
          </View>
        </View>

        {/* Delete Account Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}>
          <Text style={styles.logoutButtonText}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Save Button (Fixed at bottom) */}
      <View style={styles.saveButtonContainer}>
        <TouchableOpacity
          style={[styles.saveButton, (!hasChanges || saving) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!hasChanges || saving}>
          {saving ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
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
    paddingBottom: 100, // Space for fixed save button
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 32,
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
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: '600',
    color: '#fff',
  },
  changePhotoButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    minWidth: 140,
    alignItems: 'center',
  },
  changePhotoButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  formSection: {
    gap: 24,
    marginBottom: 32,
  },
  fieldContainer: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
  },
  readOnlyInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  readOnlyText: {
    fontSize: 16,
    color: '#666',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  toggleLabelContainer: {
    flex: 1,
  },
  logoutButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: '#1a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff4444',
    alignItems: 'center',
    marginTop: 8,
  },
  logoutButtonText: {
    fontSize: 16,
    color: '#ff4444',
    fontWeight: '600',
  },
  saveButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  saveButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
});
