import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useProfile } from '@/src/hooks/use-profile';
import { useExecutionStreaks } from '@/src/hooks/use-execution-streaks';

export default function ProfileScreen() {
  const { firstName, email, loading: profileLoading } = useProfile();
  const { currentStreakDays, bestStreakDays, loading: streaksLoading } = useExecutionStreaks();
  const [signingOut, setSigningOut] = useState(false);

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
            setSigningOut(true);
            try {
              const { error } = await supabase.auth.signOut();
              if (error) {
                Alert.alert('Error', error.message);
              }
            } catch (error) {
              Alert.alert('Error', 'An unexpected error occurred');
            } finally {
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Profile Header */}
        <View style={styles.headerSection}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(firstName)}</Text>
            </View>
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
});
