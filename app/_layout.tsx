import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { useOnboardingStatus } from '@/src/hooks/use-onboarding-status';
import { OnboardingProvider } from '@/src/contexts/onboarding-context';

type SessionState = 'loading' | 'signed_out' | 'signed_in';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  
  // Only pass session to onboarding hook when signed in
  const { status, error: onboardingError, refresh } = useOnboardingStatus(
    sessionState === 'signed_in' ? session : null
  );

  useEffect(() => {
    console.log('[RootLayout] useEffect: Starting getSession');
    setSessionState('loading');

    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('[RootLayout] getSession error:', error);
      }
      console.log('[RootLayout] getSession complete:', session ? 'Session found' : 'No session');
      setSession(session);
      setSessionState(session ? 'signed_in' : 'signed_out');
    });

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[RootLayout] onAuthStateChange:', event, session ? 'Session' : 'No session');
      setSession(session);
      setSessionState(session ? 'signed_in' : 'signed_out');
    });

    return () => {
      console.log('[RootLayout] useEffect cleanup: Unsubscribing');
      subscription.unsubscribe();
    };
  }, []);

  // Show error if tasks query failed
  if (status === 'error') {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Database Error</Text>
        <Text style={styles.errorMessage}>{onboardingError || 'Unknown error'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <StatusBar style="light" />
      </View>
    );
  }

  // Render all routes - routing is handled by app/index.tsx
  return (
    <OnboardingProvider refresh={refresh}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(paywall)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </OnboardingProvider>
  );
}
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  errorMessage: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 400,
    marginBottom: 24,
  },
  retryButton: {
    width: '100%',
    maxWidth: 400,
    height: 50,
    backgroundColor: '#fff',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  retryButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
});

