import { supabase } from '@/src/lib/supabase';

/**
 * Get device IANA timezone string (e.g., "America/Chicago", "Europe/London").
 * Uses Intl.DateTimeFormat which is available in React Native.
 * Falls back to 'UTC' if timezone cannot be determined.
 */
export function getDeviceTimezone(): string {
  try {
    // Intl.DateTimeFormat().resolvedOptions().timeZone is available in React Native
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone || 'UTC';
  } catch (error) {
    console.warn('[getDeviceTimezone] Error getting device timezone:', error);
    return 'UTC';
  }
}

/**
 * Upsert user's timezone in profiles table.
 * Sets profiles.timezone to device timezone if:
 * - Profile doesn't exist (creates it)
 * - Profile exists but timezone is NULL
 * - Profile exists but timezone is 'UTC' AND device timezone is not 'UTC'
 * 
 * This ensures all users have their correct device timezone set.
 */
export async function ensureProfileTimezone(): Promise<void> {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn('[ensureProfileTimezone] Not authenticated, skipping');
      return;
    }

    const deviceTimezone = getDeviceTimezone();
    
    // Check current profile timezone
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('timezone')
      .eq('id', user.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows found (profile doesn't exist)
      // Other errors are real problems
      console.error('[ensureProfileTimezone] Error fetching profile:', fetchError);
      return;
    }

    const currentTimezone = profile?.timezone;
    
    // Determine if we need to update timezone
    const shouldUpdate = 
      !profile || // Profile doesn't exist
      !currentTimezone || // timezone is NULL
      (currentTimezone === 'UTC' && deviceTimezone !== 'UTC'); // UTC but device is not UTC

    if (!shouldUpdate) {
      console.log('[ensureProfileTimezone] Timezone already set correctly:', currentTimezone);
      return;
    }

    // Try UPDATE first (if profile exists)
    if (profile) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ timezone: deviceTimezone })
        .eq('id', user.id);

      if (updateError) {
        console.error('[ensureProfileTimezone] Error updating profile timezone:', updateError);
        return;
      }
      console.log('[ensureProfileTimezone] Successfully updated profile timezone to:', deviceTimezone);
    } else {
      // Profile doesn't exist, try INSERT
      const { error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          timezone: deviceTimezone,
        });

      if (insertError) {
        // If insert fails (e.g., RLS), try UPDATE as fallback (profile might have been created by trigger)
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ timezone: deviceTimezone })
          .eq('id', user.id);

        if (updateError) {
          console.error('[ensureProfileTimezone] Error inserting/updating profile timezone:', insertError, updateError);
          return;
        }
        console.log('[ensureProfileTimezone] Successfully set profile timezone via UPDATE fallback:', deviceTimezone);
      } else {
        console.log('[ensureProfileTimezone] Successfully created profile with timezone:', deviceTimezone);
      }
    }
  } catch (error) {
    console.error('[ensureProfileTimezone] Unexpected error:', error);
  }
}

