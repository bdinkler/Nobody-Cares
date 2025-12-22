import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';

export function useProfile() {
  const [firstName, setFirstName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Not authenticated');
        setFirstName(null);
        setEmail(null);
        setPhone(null);
        setAvatarUrl(null);
        setLoading(false);
        return;
      }

      // Get email from auth user
      setEmail(user.email || null);

      // Fetch profile data
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('first_name, phone, avatar_url')
        .eq('id', user.id)
        .single();

      if (profileError) {
        // If profile doesn't exist, that's okay - we'll show empty fields
        if (profileError.code === 'PGRST116') {
          setFirstName(null);
          setPhone(null);
          setAvatarUrl(null);
        } else {
          console.error('[useProfile] Error fetching profile:', profileError);
          setError(profileError.message);
          setFirstName(null);
          setPhone(null);
          setAvatarUrl(null);
        }
      } else {
        setFirstName(profile?.first_name || null);
        setPhone(profile?.phone || null);
        setAvatarUrl(profile?.avatar_url || null);
      }
    } catch (err) {
      console.error('[useProfile] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setFirstName(null);
      setPhone(null);
      setAvatarUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    firstName,
    email,
    phone,
    avatarUrl,
    loading,
    error,
    refetch: fetchProfile,
  };
}

