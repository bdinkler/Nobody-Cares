import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/src/lib/supabase';
import { useProfile } from '@/src/hooks/use-profile';

type Post = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  image_urls?: string[] | null;
};

type PostWithAuthor = Post & {
  author_first_name: string | null;
  author_avatar_url: string | null;
  author_streak: number;
};

type CohortRanking = {
  user_id: string;
  first_name: string | null;
  avatar_url: string | null;
  completion_pct: number;
  completed_instances: number;
  eligible_instances: number;
};

export default function CommunityScreen() {
  const { firstName, avatarUrl } = useProfile();
  const [selectedTab, setSelectedTab] = useState<'cohort' | 'feed'>('feed');
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);
  const hasFetchedRef = useRef(false);
  
  // Cohort rankings state
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rankings, setRankings] = useState<CohortRanking[]>([]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [resetsOn, setResetsOn] = useState<string | null>(null);
  const [monthName, setMonthName] = useState<string | null>(null);
  const [loadingRankings, setLoadingRankings] = useState(false);
  const [errorRankings, setErrorRankings] = useState<string | null>(null);
  const [notInCohort, setNotInCohort] = useState(false);
  const isFetchingRankingsRef = useRef(false);
  const hasFetchedRankingsRef = useRef(false);

  const fetchPosts = useCallback(async () => {
    // Guard: prevent overlapping calls
    if (isFetchingRef.current) {
      return;
    }

    // Guard: only fetch if Feed tab is selected
    if (selectedTab !== 'feed') {
      return;
    }

    try {
      isFetchingRef.current = true;
      setLoading(true);
      setError(null);

      // Fetch posts (newest first, limit 20)
      // Only query global scope posts to avoid cohort-related RLS recursion
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('id, author_id, body, created_at, image_urls, scope')
        .eq('scope', 'global')
        .order('created_at', { ascending: false })
        .limit(20);

      if (postsError) {
        console.error('[CommunityScreen] Error fetching posts:', postsError);
        setError(postsError.message);
        setLoading(false);
        isFetchingRef.current = false;
        return;
      }

      if (!postsData || postsData.length === 0) {
        setPosts([]);
        setLoading(false);
        isFetchingRef.current = false;
        hasFetchedRef.current = true;
        return;
      }

      // Get unique author IDs
      const authorIds = [...new Set(postsData.map((p) => p.author_id))];

      // Fetch profiles for all authors
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, first_name, avatar_url')
        .in('id', authorIds);

      if (profilesError) {
        console.error('[CommunityScreen] Error fetching profiles:', profilesError);
        // Continue with empty profiles
      }

      // Fetch streaks for all authors using timezone-safe RPC
      // Call RPC for each author (could be optimized with a batch function later)
      const streaksPromises = authorIds.map(async (authorId) => {
        const { data: streakDataArray, error: streakError } = await supabase
          .rpc('get_execution_streaks', { p_user_id: authorId });
        
        if (streakError) {
          console.error(`[CommunityScreen] Error fetching streak for user ${authorId}:`, streakError);
          return { user_id: authorId, current_streak_days: 0 };
        }
        
        const streakData = streakDataArray && streakDataArray.length > 0 ? streakDataArray[0] : null;
        return {
          user_id: authorId,
          current_streak_days: streakData?.current_streak_days ?? 0,
        };
      });
      
      const streaksData = await Promise.all(streaksPromises);

      // Create maps for easy lookup
      const profilesMap = new Map(
        (profilesData || []).map((p) => [p.id, { first_name: p.first_name, avatar_url: p.avatar_url }])
      );
      const streaksMap = new Map(
        (streaksData || []).map((s) => [s.user_id, s.current_streak_days ?? 0])
      );

      // Combine posts with author info and streaks
      const postsWithAuthors: PostWithAuthor[] = postsData.map((post) => {
        const profile = profilesMap.get(post.author_id);
        const streak = streaksMap.get(post.author_id) ?? 0;

        return {
          ...post,
          author_first_name: profile?.first_name || null,
          author_avatar_url: profile?.avatar_url || null,
          author_streak: streak,
        };
      });

      setPosts(postsWithAuthors);
      hasFetchedRef.current = true;
    } catch (err) {
      console.error('[CommunityScreen] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [selectedTab]);

  // Fetch cohort rankings
  const fetchRankings = useCallback(async () => {
    // Guard: prevent overlapping calls
    if (isFetchingRankingsRef.current) {
      return;
    }

    // Guard: only fetch if Cohort tab is selected
    if (selectedTab !== 'cohort') {
      return;
    }

    try {
      isFetchingRankingsRef.current = true;
      setLoadingRankings(true);
      setErrorRankings(null);

      // Get current user ID
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('[CommunityScreen] Error getting user:', authError);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        return;
      }

      setCurrentUserId(user.id);

      // Check if user is already in a cohort for current month (lightweight read first)
      // This avoids unnecessary RPC calls once user is assigned
      const { data: existingMembership, error: membershipCheckError } = await supabase
        .from('user_current_cohort')
        .select('cycle_cohort_id, cycle_start_date, cycle_end_date')
        .eq('user_id', user.id)
        .maybeSingle();

      let cohortData;
      let rpcError;

      if (membershipCheckError) {
        // If view query fails, log and proceed to RPC (fallback)
        console.warn('[CommunityScreen] Error checking existing membership, falling back to RPC:', membershipCheckError);
        const rpcResult = await supabase.rpc('ensure_monthly_cycle_and_assign_user');
        cohortData = rpcResult.data;
        rpcError = rpcResult.error;
      } else if (existingMembership?.cycle_cohort_id) {
        // User already in cohort - fetch cohort metadata without calling RPC
        if (__DEV__) {
          console.log('[CommunityScreen] User already in cohort, fetching metadata directly (skipping RPC)');
        }
        
        // Get cohort metadata (cohort_number, cycle_id)
        const { data: cohortRow, error: cohortError } = await supabase
          .from('cycle_cohorts')
          .select('id, cycle_id, cohort_number')
          .eq('id', existingMembership.cycle_cohort_id)
          .single();

        if (cohortError || !cohortRow) {
          // Fallback to RPC if cohort fetch fails
          if (__DEV__) {
            console.warn('[CommunityScreen] Error fetching cohort row, falling back to RPC:', cohortError);
          }
          const rpcResult = await supabase.rpc('ensure_monthly_cycle_and_assign_user');
          cohortData = rpcResult.data;
          rpcError = rpcResult.error;
        } else {
          // Get cycle dates
          const { data: cycleRow, error: cycleError } = await supabase
            .from('cohort_cycles')
            .select('start_date, end_date')
            .eq('id', cohortRow.cycle_id)
            .single();

          if (cycleError || !cycleRow) {
            // Fallback to RPC if cycle fetch fails
            if (__DEV__) {
              console.warn('[CommunityScreen] Error fetching cycle row, falling back to RPC:', cycleError);
            }
            const rpcResult = await supabase.rpc('ensure_monthly_cycle_and_assign_user');
            cohortData = rpcResult.data;
            rpcError = rpcResult.error;
          } else {
            // Get member count
            const { count: memberCount } = await supabase
              .from('cycle_cohort_members')
              .select('*', { count: 'exact', head: true })
              .eq('cycle_cohort_id', existingMembership.cycle_cohort_id);

            // Calculate resets_on (month_end + 1 day)
            const monthEndDate = new Date(cycleRow.end_date);
            monthEndDate.setDate(monthEndDate.getDate() + 1);
            const resetsOn = monthEndDate.toISOString().split('T')[0];

            // Format as if returned from RPC
            cohortData = [{
              cycle_id: cohortRow.cycle_id,
              cycle_cohort_id: existingMembership.cycle_cohort_id,
              cohort_number: cohortRow.cohort_number,
              member_count: memberCount || 0,
              resets_on: resetsOn,
              month_start: cycleRow.start_date,
              month_end: cycleRow.end_date,
            }];
            rpcError = null;
          }
        }
      } else {
        // User not in cohort - call RPC to assign
        if (__DEV__) {
          console.log('[CommunityScreen] User not in cohort, calling RPC for assignment');
        }
        const rpcResult = await supabase.rpc('ensure_monthly_cycle_and_assign_user');
        cohortData = rpcResult.data;
        rpcError = rpcResult.error;
      }

      if (rpcError) {
        console.error('[CommunityScreen] Error calling ensure_monthly_cycle_and_assign_user:', rpcError);
        setErrorRankings(rpcError.message);
        setNotInCohort(false);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        hasFetchedRankingsRef.current = true;
        return;
      }

      if (!cohortData || cohortData.length === 0) {
        // RPC returned no data - show empty state
        setNotInCohort(true);
        setErrorRankings(null);
        setRankings([]);
        setCohortId(null);
        setMemberCount(null);
        setResetsOn(null);
        setMonthName(null);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        hasFetchedRankingsRef.current = true;
        return;
      }

      const cohort = cohortData[0];
      const userCohortId = cohort.cycle_cohort_id;

      setNotInCohort(false);
      setCohortId(userCohortId);
      setMemberCount(cohort.member_count || 0);
      setResetsOn(cohort.resets_on);

      // Format month name from month_start (always use RPC month_start)
      // Use UTC timezone to avoid date shifts when parsing YYYY-MM-DD strings
      // cohort.month_start is already a date string like "2025-12-01"
      const monthStartISO = cohort.month_start + 'T00:00:00Z';
      const formattedMonthName = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        timeZone: 'UTC',
      }).format(new Date(monthStartISO));
      setMonthName(formattedMonthName);
      if (__DEV__) {
        console.log('[CommunityScreen] Cohort month label:', {
          month_start_iso: monthStartISO,
          formatted_label: formattedMonthName,
        });
      }

      // Fetch all cohort members
      const { data: cohortMembers, error: membersError } = await supabase
        .from('cycle_cohort_members')
        .select('user_id')
        .eq('cycle_cohort_id', userCohortId);

      if (membersError) {
        console.error('[CommunityScreen] Error fetching cohort members:', membersError);
        setErrorRankings(membersError.message);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        hasFetchedRankingsRef.current = true;
        return;
      }

      if (!cohortMembers || cohortMembers.length === 0) {
        setRankings([]);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        hasFetchedRankingsRef.current = true;
        return;
      }

      // Fetch month-to-date consistency using timezone-safe RPC
      // This ensures each user's "today" is computed using their profiles.timezone
      const { data: consistencyData, error: consistencyError } = await supabase
        .rpc('get_cohort_month_to_date_consistency', { p_cohort_id: userCohortId });

      if (consistencyError) {
        console.error('[CommunityScreen] Error fetching consistency data:', consistencyError);
        setErrorRankings(consistencyError.message);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        hasFetchedRankingsRef.current = true;
        return;
      }

      if (__DEV__) {
        console.log('[CommunityScreen] Cohort consistency data:', {
          cohort_id: userCohortId,
          data_count: consistencyData?.length || 0,
          data: consistencyData,
        });
      }

      // RPC returns array of consistency data for all cohort members
      // Create a map of consistency data by user_id for quick lookup
      const consistencyMap = new Map(
        (consistencyData || []).map((c) => [
          c.user_id,
          {
            eligible_instances: c.eligible_instances || 0,
            completed_instances: c.completed_instances || 0,
            completion_pct: c.completion_pct || 0,
          },
        ])
      );

      // Get all user IDs from cohort members
      const userIds = cohortMembers.map((m) => m.user_id);

      // Create rankings data for ALL cohort members (not just those with consistency data)
      // This ensures all members appear in the leaderboard, even if they have no data yet
      const rankingsData = userIds.map((userId) => {
        const consistency = consistencyMap.get(userId);
        return {
          user_id: userId,
          eligible_instances: consistency?.eligible_instances || 0,
          completed_instances: consistency?.completed_instances || 0,
          completion_pct: consistency?.completion_pct || 0,
        };
      });

      if (rankingsData.length === 0) {
        setRankings([]);
        setLoadingRankings(false);
        isFetchingRankingsRef.current = false;
        hasFetchedRankingsRef.current = true;
        return;
      }

      // Sort rankings: completion_pct desc, completed_instances desc, user_id asc (for tie-breaking)
      const sortedRankings = [...rankingsData].sort((a, b) => {
        // Primary: completion_pct descending
        if (b.completion_pct !== a.completion_pct) {
          return b.completion_pct - a.completion_pct;
        }
        // Secondary: completed_instances descending
        if (b.completed_instances !== a.completed_instances) {
          return b.completed_instances - a.completed_instances;
        }
        // Tertiary: user_id ascending (for consistent tie-breaking)
        return a.user_id.localeCompare(b.user_id);
      });

      // Fetch profiles for all cohort members (use userIds to ensure we get all members)
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, first_name, avatar_url')
        .in('id', userIds);

      if (profilesError) {
        console.error('[CommunityScreen] Error fetching profiles for rankings:', profilesError);
        // Continue with empty profiles
      }

      // Create profile map
      const profilesMap = new Map(
        (profilesData || []).map((p) => [p.id, { first_name: p.first_name, avatar_url: p.avatar_url }])
      );

      // Combine rankings with profile data (using sorted rankings)
      const rankingsWithProfiles: CohortRanking[] = sortedRankings.map((ranking) => {
        const profile = profilesMap.get(ranking.user_id);
        return {
          user_id: ranking.user_id,
          first_name: profile?.first_name || null,
          avatar_url: profile?.avatar_url || null,
          completion_pct: ranking.completion_pct || 0,
          completed_instances: ranking.completed_instances || 0,
          eligible_instances: ranking.eligible_instances || 0,
        };
      });

      setRankings(rankingsWithProfiles);
      hasFetchedRankingsRef.current = true;
    } catch (err) {
      console.error('[CommunityScreen] Unexpected error fetching rankings:', err);
      setErrorRankings(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingRankings(false);
      isFetchingRankingsRef.current = false;
    }
  }, [selectedTab]);

  // Refetch cohort data when screen gains focus (Cohort tab)
  // This ensures cohort % updates immediately after completing/resting tasks
  useFocusEffect(
    useCallback(() => {
      // Always refetch cohort rankings when screen gains focus and cohort tab is selected
      if (selectedTab === 'cohort' && !isFetchingRankingsRef.current) {
        // Reset the hasFetched flag to allow refetch
        hasFetchedRankingsRef.current = false;
        fetchRankings();
      } else if (selectedTab === 'feed' && !hasFetchedRef.current && !isFetchingRef.current) {
        // Feed tab: only fetch if not already fetched
        fetchPosts();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTab])
  );

  const handleNewPostPress = () => {
    router.push('/community/new-post');
  };

  const getInitials = (name: string | null): string => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getMonthName = (): string => {
    return new Date().toLocaleDateString('en-US', { month: 'long' });
  };

  const getNextMonthName = (): string => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.toLocaleDateString('en-US', { month: 'long' });
  };

  const getNextMonthDay1 = (): string => {
    // Fallback to next month day 1
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    return nextMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatResetsDate = (dateString: string): string => {
    // Use UTC timezone to avoid date shifts when parsing YYYY-MM-DD strings
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(dateString + 'T00:00:00Z'));
  };

  const formatMemberCount = (count: number | null): string => {
    if (count === null) return '—';
    return `${count} member${count === 1 ? '' : 's'}`;
  };

  const formatPostDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Pull-to-refresh handlers
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (selectedTab === 'cohort') {
        // Reset flags to allow refetch
        hasFetchedRankingsRef.current = false;
        await fetchRankings();
      } else if (selectedTab === 'feed') {
        // Reset flags to allow refetch
        hasFetchedRef.current = false;
        await fetchPosts();
      }
    } finally {
      setRefreshing(false);
    }
  }, [selectedTab, fetchRankings, fetchPosts]);

  // Only show full-screen loading on initial mount when Feed tab is default
  // Otherwise, show inline loading in Feed view

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            colors={['#fff']}
          />
        }>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Community</Text>
        </View>

        {/* Segmented Control / Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'feed' && styles.tabActive]}
            onPress={() => {
              setSelectedTab('feed');
              if (!hasFetchedRef.current && !isFetchingRef.current) {
                fetchPosts();
              }
            }}
            activeOpacity={0.7}>
            <Text style={[styles.tabText, selectedTab === 'feed' && styles.tabTextActive]}>
              Feed
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'cohort' && styles.tabActive]}
            onPress={() => {
              setSelectedTab('cohort');
              if (!hasFetchedRankingsRef.current && !isFetchingRankingsRef.current) {
                fetchRankings();
              }
            }}
            activeOpacity={0.7}>
            <Text style={[styles.tabText, selectedTab === 'cohort' && styles.tabTextActive]}>
              Cohort
            </Text>
          </TouchableOpacity>
        </View>

        {/* Cohort View */}
        {selectedTab === 'cohort' && (
          <>
            {/* Cohort Header */}
            <View style={styles.cohortHeader}>
              <Text style={styles.cohortTitle}>{monthName || 'Cohort'} Cohort</Text>
              <Text style={styles.cohortSubtitle}>
                {formatMemberCount(memberCount)} • Resets {resetsOn ? formatResetsDate(resetsOn) : getNextMonthDay1()}
              </Text>
            </View>

            {/* Rankings List */}
            {loadingRankings ? (
              <View style={styles.rankingsLoadingContainer}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            ) : notInCohort ? (
              <View style={styles.rankingsCard}>
                <Text style={styles.rankingsTitle}>Not in a cohort yet</Text>
                <Text style={styles.rankingsSubtext}>You'll be assigned after purchase/onboarding.</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    hasFetchedRankingsRef.current = false;
                    fetchRankings();
                  }}
                  activeOpacity={0.7}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : errorRankings ? (
              <View style={styles.rankingsErrorContainer}>
                <Text style={styles.rankingsErrorText}>{errorRankings}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    hasFetchedRankingsRef.current = false;
                    fetchRankings();
                  }}
                  activeOpacity={0.7}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : rankings.length === 0 ? (
              <View style={styles.rankingsCard}>
                <Text style={styles.rankingsTitle}>No rankings yet</Text>
                <Text style={styles.rankingsSubtext}>Rankings will appear here once data is available</Text>
              </View>
            ) : (
              <View style={styles.rankingsList}>
                {rankings.map((ranking, index) => {
                  const rank = index + 1;
                  const isCurrentUser = ranking.user_id === currentUserId;
                  
                  return (
                    <View
                      key={ranking.user_id}
                      style={[
                        styles.rankingRow,
                        isCurrentUser && styles.rankingRowCurrentUser,
                      ]}>
                      <Text style={styles.rankingNumber}>{rank}</Text>
                      {ranking.avatar_url ? (
                        <Image
                          source={{ uri: ranking.avatar_url }}
                          style={styles.rankingAvatar}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.rankingAvatar}>
                          <Text style={styles.rankingAvatarText}>
                            {getInitials(ranking.first_name)}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.rankingName} numberOfLines={1}>
                        {ranking.first_name && ranking.first_name.trim() ? ranking.first_name.trim() : 'Anonymous'}
                      </Text>
                      <Text style={styles.rankingPct}>{ranking.completion_pct}%</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* Feed View */}
        {selectedTab === 'feed' && (
          <>
            {/* Post Composer Button */}
            <TouchableOpacity
              style={styles.composerCard}
              onPress={handleNewPostPress}
              activeOpacity={0.7}>
              <View style={styles.composerContent}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.composerAvatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.composerAvatar}>
                    <Text style={styles.composerAvatarText}>{getInitials(firstName)}</Text>
                  </View>
                )}
                <Text style={styles.composerPlaceholder}>What did you execute today?</Text>
              </View>
            </TouchableOpacity>

            {/* Posts List */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Error: {error}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    hasFetchedRef.current = false;
                    fetchPosts();
                  }}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {loading && posts.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            ) : posts.length === 0 && !error ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No posts yet. Share a win.</Text>
              </View>
            ) : (
              <View style={styles.postsContainer}>
                {posts.map((post) => (
                  <View key={post.id} style={styles.postCard}>
                    {/* Post Header */}
                    <View style={styles.postHeader}>
                      <View style={styles.postHeaderLeft}>
                        {post.author_avatar_url ? (
                          <Image
                            source={{ uri: post.author_avatar_url }}
                            style={styles.postAvatar}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.postAvatar}>
                            <Text style={styles.postAvatarText}>
                              {getInitials(post.author_first_name)}
                            </Text>
                          </View>
                        )}
                        <View style={styles.postAuthorInfo}>
                          <Text style={styles.postAuthorName}>
                            {post.author_first_name || 'Anonymous'}
                          </Text>
                          <Text style={styles.postMeta}>
                            🔥{post.author_streak} • {formatPostDate(post.created_at)}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Post Content */}
                    <Text style={styles.postContent}>{post.body}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
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
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#000',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  cohortHeader: {
    marginBottom: 24,
  },
  cohortTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  cohortSubtitle: {
    fontSize: 14,
    color: '#999',
  },
  rankingsCard: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  rankingsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  rankingsSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  rankingsLoadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankingsErrorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  rankingsErrorText: {
    fontSize: 14,
    color: '#ff4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  rankingsList: {
    gap: 8,
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  rankingRowCurrentUser: {
    borderColor: '#666',
    backgroundColor: '#1a1a1a',
  },
  rankingNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
    width: 32,
    textAlign: 'right',
    marginRight: 12,
  },
  rankingAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankingAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  rankingName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#fff',
    marginRight: 12,
  },
  rankingPct: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  composerCard: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  composerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  composerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  composerAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  composerPlaceholder: {
    fontSize: 16,
    color: '#666',
  },
  postsContainer: {
    gap: 12,
  },
  postCard: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  postHeader: {
    marginBottom: 12,
  },
  postHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  postAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  postAuthorInfo: {
    flex: 1,
  },
  postAuthorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  postMeta: {
    fontSize: 12,
    color: '#999',
  },
  postContent: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 22,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontSize: 14,
    color: '#ff4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#333',
    borderRadius: 6,
    marginTop: 16,
  },
  retryButtonText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
});
