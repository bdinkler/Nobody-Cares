import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';
import { useOnboardingStatus } from '@/src/hooks/use-onboarding-status';
import { getEarlyAccessAck } from '@/src/lib/subscription';

type SessionState = 'loading' | 'signed_out' | 'signed_in';

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [earlyAccessAck, setEarlyAccessAck] = useState<boolean | null>(null);
  const { status, loading: onboardingLoading } = useOnboardingStatus(
    sessionState === 'signed_in' ? session : null
  );

  // Load early access acknowledgement status
  useEffect(() => {
    const loadEarlyAccessAck = async () => {
      const value = await getEarlyAccessAck();
      setEarlyAccessAck(value);
      console.log('[Index] earlyAccessAck=', value);
    };
    loadEarlyAccessAck();
  }, []);

  useEffect(() => {
    console.log('[Index] useEffect: Starting getSession');
    setSessionState('loading');

    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('[Index] getSession error:', error);
      }
      console.log('[Index] getSession complete:', session ? 'Session found' : 'No session');
      setSession(session);
      setSessionState(session ? 'signed_in' : 'signed_out');
    });

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Index] onAuthStateChange:', event, session ? 'Session' : 'No session');
      setSession(session);
      setSessionState(session ? 'signed_in' : 'signed_out');
    });

    return () => {
      console.log('[Index] useEffect cleanup: Unsubscribing');
      subscription.unsubscribe();
    };
  }, []);

  // Show loading during initial session load
  if (sessionState === 'loading') {
    console.log('[Index] Rendering: Loading (sessionState = loading)');
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  // Signed out -> redirect to welcome
  if (sessionState === 'signed_out') {
    console.log('[Index] Rendering: Redirect to /welcome (signed_out)');
    return <Redirect href="/welcome" />;
  }

  // Signed in and checking onboarding -> show loading
  if (sessionState === 'signed_in' && (onboardingLoading || status === 'checking')) {
    console.log('[Index] Rendering: Loading (checking onboarding)');
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  // Signed in and needs onboarding -> redirect to onboarding
  if (sessionState === 'signed_in' && status === 'needs_onboarding') {
    console.log('[Index] Rendering: Redirect to /(onboarding)/ownership');
    return <Redirect href="/(onboarding)/ownership" />;
  }

  // Signed in and onboarding complete -> check early access acknowledgement
  if (sessionState === 'signed_in' && status === 'complete') {
    // Show loading while early access ack status is being loaded
    if (earlyAccessAck === null) {
      console.log('[Index] Rendering: Loading (checking early access ack)');
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      );
    }

    // If early access not acknowledged -> redirect to Early Access screen
    if (!earlyAccessAck) {
      console.log('[Index] Rendering: Redirect to /(paywall) (no early access ack)');
      return <Redirect href="/(paywall)" />;
    }

    // If early access acknowledged -> redirect to tabs (regardless of subscription status)
    if (earlyAccessAck) {
      console.log('[Index] Rendering: Redirect to /(tabs) (early access acknowledged)');
      return <Redirect href="/(tabs)" />;
    }
  }

  // Error state -> show error (handled by _layout.tsx)
  // Fallback to loading
  console.log('[Index] Rendering: Fallback loading (sessionState:', sessionState, 'status:', status, ')');
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

