import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Session } from '@supabase/supabase-js';

export type OnboardingStatus = 'idle' | 'checking' | 'needs_onboarding' | 'complete' | 'error';

export type OnboardingDebugInfo = {
  visionPresent: boolean;
  tasksCount: number;
};

export function useOnboardingStatus(session: Session | null) {
  const [status, setStatus] = useState<OnboardingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<OnboardingDebugInfo | null>(null);
  const hasCheckedRef = useRef(false);
  const isCheckingRef = useRef(false);

  const checkOnboardingStatus = useCallback(async () => {
    if (!session || isCheckingRef.current) {
      console.log('[Onboarding] checkOnboardingStatus: Skipping - no session or already checking');
      return;
    }

    console.log('[Onboarding] checkOnboardingStatus: Starting check');
    isCheckingRef.current = true;
    setStatus('checking');
    setError(null);

    try {
      const userId = session.user.id;
      console.log('[Onboarding] checkOnboardingStatus: User ID:', userId);

      // Fetch profile
      console.log('[Onboarding] checkOnboardingStatus: Fetching profile...');
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('vision_statement')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('[Onboarding] checkOnboardingStatus: Error fetching profile:', profileError);
        setStatus('needs_onboarding');
        setDebugInfo({ visionPresent: false, tasksCount: 0 });
        isCheckingRef.current = false;
        return;
      }

      // Check if vision_statement exists
      const hasVision = profile?.vision_statement !== null;
      console.log('[Onboarding] checkOnboardingStatus: Has vision:', hasVision);

      // Fetch active tasks count - using is_active column
      console.log('[Onboarding] checkOnboardingStatus: Fetching tasks...');
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (tasksError) {
        console.error('[Onboarding] checkOnboardingStatus: Error fetching tasks:', tasksError);
        const errorMessage = tasksError.message || String(tasksError);
        setError(errorMessage);
        setStatus('error');
        setDebugInfo({ visionPresent: hasVision, tasksCount: 0 });
        isCheckingRef.current = false;
        return;
      }

      const tasksCount = tasks?.length ?? 0;
      const hasTasks = tasksCount >= 1;
      console.log('[Onboarding] checkOnboardingStatus: Tasks count:', tasksCount, 'Has tasks:', hasTasks);

      // Update debug info
      setDebugInfo({ visionPresent: hasVision, tasksCount });

      // Onboarding is complete if both conditions are met
      if (hasVision && hasTasks) {
        console.log('[Onboarding] checkOnboardingStatus: Complete!');
        setStatus('complete');
      } else {
        console.log('[Onboarding] checkOnboardingStatus: Needs onboarding');
        setStatus('needs_onboarding');
      }
    } catch (error) {
      console.error('[Onboarding] checkOnboardingStatus: Unexpected error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      setStatus('error');
      setDebugInfo({ visionPresent: false, tasksCount: 0 });
    } finally {
      isCheckingRef.current = false;
      console.log('[Onboarding] checkOnboardingStatus: Finished');
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      console.log('[Onboarding] useEffect: No session, setting status to idle');
      setStatus('idle');
      setError(null);
      setDebugInfo(null);
      hasCheckedRef.current = false;
      isCheckingRef.current = false;
      return;
    }

    // Only check once when session is established
    if (!hasCheckedRef.current) {
      console.log('[Onboarding] useEffect: Session exists, checking onboarding status');
      hasCheckedRef.current = true;
      checkOnboardingStatus();
    }
  }, [session, checkOnboardingStatus]);

  // Expose refresh function for manual refresh
  const refresh = useCallback(() => {
    console.log('[Onboarding] refresh: Manual refresh requested');
    hasCheckedRef.current = false;
    checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  return {
    status,
    error,
    debugInfo,
    refresh,
    loading: status === 'checking',
    isOnboardingComplete: status === 'complete',
  };
}

