import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { setSubscribed } from '@/src/lib/subscription';

export default function PaywallScreen() {
  const [loading, setLoading] = useState(false);

  const handleStartMembership = async () => {
    setLoading(true);
    try {
      await setSubscribed(true);
      console.log('[Paywall] dev subscribed set to true');
      // Navigate directly to tabs after setting subscription
      router.replace('/(tabs)');
    } catch (error) {
      console.error('[Paywall] Error setting subscription:', error);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Start your membership</Text>
        <Text style={styles.subheading}>Build consistency. Track execution. Stay accountable.</Text>

        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.buttonDisabled]}
          onPress={handleStartMembership}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryButtonText}>Start your 7-day Free Trial</Text>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 16,
    color: '#999',
    marginBottom: 40,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 400,
  },
  primaryButton: {
    width: '100%',
    maxWidth: 400,
    height: 56,
    backgroundColor: '#fff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
