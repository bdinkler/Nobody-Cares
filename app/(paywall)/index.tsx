import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, SafeAreaView, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { setEarlyAccessAck } from '@/src/lib/subscription';

export default function EarlyAccessScreen() {
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    setLoading(true);
    try {
      await setEarlyAccessAck(true);
      console.log('[EarlyAccess] early access ack set to true');
      // Navigate directly to tabs after acknowledging early access
      router.replace('/(tabs)');
    } catch (error) {
      console.error('[EarlyAccess] Error setting early access ack:', error);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Early Access</Text>
          <Text style={styles.subtitle}>Help shape the future of Nobody Cares.</Text>
          
          <Text style={styles.body}>
            Build discipline. Track execution. Stay accountable — with a community that actually shows up.
          </Text>

          <View style={styles.bulletsContainer}>
            <View style={styles.bulletItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>Execution tracking & streaks</Text>
            </View>
            <View style={styles.bulletItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>Monthly cohorts (reset monthly)</Text>
            </View>
            <View style={styles.bulletItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>Community accountability feed</Text>
            </View>
          </View>

          <Text style={styles.note}>
            This product is still evolving. Early members directly influence what gets built next.
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue with Early Access</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.subscriptionNote}>Subscription coming soon</Text>
          <Text style={styles.noChargeText}>No charge today</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100%',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '600',
  },
  body: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 400,
  },
  bulletsContainer: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 32,
  },
  bulletItem: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  bullet: {
    fontSize: 16,
    color: '#fff',
    marginRight: 12,
    lineHeight: 24,
  },
  bulletText: {
    fontSize: 16,
    color: '#fff',
    flex: 1,
    lineHeight: 24,
  },
  note: {
    fontSize: 14,
    color: '#999',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 400,
    fontStyle: 'italic',
  },
  primaryButton: {
    width: '100%',
    maxWidth: 400,
    height: 56,
    backgroundColor: '#fff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  subscriptionNote: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 4,
  },
  noChargeText: {
    fontSize: 10,
    color: '#444',
    textAlign: 'center',
  },
});

