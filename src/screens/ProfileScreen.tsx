import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useProfile } from '@/src/hooks/use-profile';
import { useExecutionStreaks } from '@/src/hooks/use-execution-streaks';
import { resetDevState } from '@/src/lib/subscription';
import Constants from 'expo-constants';

export default function ProfileScreen() {
  const { firstName, email, avatarUrl, loading: profileLoading } = useProfile();
  const { currentStreakDays, bestStreakDays, loading: streaksLoading } = useExecutionStreaks();
  const [signingOut, setSigningOut] = useState(false);
  const [devModalVisible, setDevModalVisible] = useState(false);
  const [resetting, setResetting] = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getInitials = (name: string | null): string => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            console.log('[Logout] confirm pressed');
            setSigningOut(true);
            try {
              const { error } = await supabase.auth.signOut();
              if (error) {
                console.error('[Logout] signOut error:', error);
                Alert.alert('Error', error.message);
                // Reset state on error so user can try again
                setSigningOut(false);
              } else {
                console.log('[Logout] signOut success');
                // Reset state before navigation to ensure cleanup
                setSigningOut(false);
                // Explicitly navigate to welcome/login screen
                // The auth state change listener should also handle this, but we ensure it happens
                console.log('[Logout] redirecting to login');
                router.replace('/welcome');
              }
            } catch (error) {
              console.error('[Logout] unexpected error:', error);
              Alert.alert('Error', 'An unexpected error occurred');
              // Reset state on error so user can try again
              setSigningOut(false);
            }
          },
        },
      ]
    );
  };

  const handleEditProfile = () => {
    router.push('/profile/edit');
  };

  const handleManageTasks = () => {
    router.push('/profile/tasks');
  };

  const handleGiveFeedback = () => {
    router.push('/profile/feedback');
  };

  const handleSupport = () => {
    router.push('/profile/support');
  };

  const handleManageSubscription = () => {
    router.push('/profile/subscription');
  };

  const handleVersionTap = () => {
    if (!__DEV__) return;

    // Reset timeout if user stops tapping
    if (versionTapTimeout.current) {
      clearTimeout(versionTapTimeout.current);
    }

    versionTapCount.current += 1;

    // Reset count after 2 seconds of no taps
    versionTapTimeout.current = setTimeout(() => {
      versionTapCount.current = 0;
    }, 2000);

    // Show dev modal after 7 taps
    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      if (versionTapTimeout.current) {
        clearTimeout(versionTapTimeout.current);
      }
      setDevModalVisible(true);
    }
  };

  const handleResetDevState = async () => {
    if (!__DEV__) return;

    Alert.alert(
      'Reset Dev State',
      'This will clear all dev flags (early access ack, subscription, etc.) and reload the app. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await resetDevState();
              Alert.alert(
                'Reset Complete',
                'Dev state cleared. The app will reload.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Navigate to root to trigger re-evaluation of onboarding/paywall gates
                      router.replace('/');
                    },
                  },
                ]
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to reset dev state');
              console.error('[ProfileScreen] Error resetting dev state:', error);
            } finally {
              setResetting(false);
              setDevModalVisible(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Profile Header */}
        <View style={styles.headerSection}>
          <View style={styles.avatarContainer}>
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
          </View>
          <TouchableOpacity
            onPress={handleEditProfile}
            activeOpacity={0.7}
            style={styles.nameContainer}>
            {firstName ? (
              <Text style={styles.nameText}>{firstName}</Text>
            ) : (
              <Text style={styles.namePlaceholder}>Add your name</Text>
            )}
            {email && (
              <Text style={styles.emailText}>{email}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Best execution streak</Text>
            <Text style={styles.statValue}>
              {streaksLoading ? '—' : `${bestStreakDays} ${bestStreakDays === 1 ? 'day' : 'days'}`}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Current execution streak</Text>
            <Text style={styles.statValue}>
              {streaksLoading ? '—' : `${currentStreakDays} ${currentStreakDays === 1 ? 'day' : 'days'}`}
            </Text>
          </View>
        </View>

        {/* Action List */}
        <View style={styles.actionsSection}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleEditProfile}
            activeOpacity={0.7}>
            <Text style={styles.actionText}>Edit Profile</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleManageTasks}
            activeOpacity={0.7}>
            <Text style={styles.actionText}>Manage Tasks</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleGiveFeedback}
            activeOpacity={0.7}>
            <Text style={styles.actionText}>Give Feedback</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleManageSubscription}
            activeOpacity={0.7}>
            <Text style={styles.actionText}>Manage Subscription</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSupport}
            activeOpacity={0.7}>
            <Text style={styles.actionText}>Support / Contact</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.actionDivider} />

          <TouchableOpacity
            style={[styles.actionRow, styles.logoutRow]}
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.7}>
            {signingOut ? (
              <ActivityIndicator size="small" color="#ff4444" />
            ) : (
              <Text style={styles.logoutText}>Logout</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Version Text (dev trigger) */}
        {__DEV__ && (
          <TouchableOpacity
            onPress={handleVersionTap}
            activeOpacity={0.7}
            style={styles.versionContainer}>
            <Text style={styles.versionText}>
              Version {Constants.expoConfig?.version || '1.0.0'}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Dev Modal */}
      {__DEV__ && (
        <Modal
          visible={devModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDevModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Dev Tools</Text>
              <Text style={styles.modalDescription}>
                Reset local dev state (early access ack, subscription flags, etc.)
              </Text>
              <TouchableOpacity
                style={[styles.modalButton, resetting && styles.modalButtonDisabled]}
                onPress={handleResetDevState}
                disabled={resetting}>
                {resetting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalButtonText}>Reset Dev State</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setDevModalVisible(false)}>
                <Text style={styles.modalButtonTextSecondary}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
  headerSection: {
    alignItems: 'center',
    marginBottom: 32,
    paddingTop: 20,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '600',
    color: '#fff',
  },
  nameContainer: {
    alignItems: 'center',
  },
  nameText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  namePlaceholder: {
    fontSize: 24,
    fontWeight: '600',
    color: '#999',
    marginBottom: 4,
  },
  emailText: {
    fontSize: 14,
    color: '#666',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  actionsSection: {
    gap: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  actionText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  chevron: {
    fontSize: 24,
    color: '#666',
    fontWeight: '300',
  },
  actionDivider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 8,
  },
  logoutRow: {
    justifyContent: 'center',
    borderColor: '#444',
  },
  logoutText: {
    fontSize: 16,
    color: '#ff4444',
    fontWeight: '500',
  },
  versionContainer: {
    marginTop: 32,
    paddingVertical: 12,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    color: '#444',
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
    maxWidth: 400,
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
  modalDescription: {
    fontSize: 14,
    color: '#999',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalButton: {
    backgroundColor: '#ff4444',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalButtonTextSecondary: {
    fontSize: 16,
    fontWeight: '500',
    color: '#fff',
  },
});
