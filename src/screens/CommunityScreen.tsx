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
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/src/lib/supabase';
import { useProfile } from '@/src/hooks/use-profile';
import { useFeed } from '@/src/hooks/use-feed';
import { formatPostTimestamp } from '@/src/lib/date-utils';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

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
  const { posts, loading, error, refetch: refetchFeed, toggleLike, createPost, deletePost } = useFeed();
  const [selectedTab, setSelectedTab] = useState<'cohort' | 'feed'>('feed');
  
  // Inline composer state
  const [composerText, setComposerText] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  
  // Cohort rankings state
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rankings, setRankings] = useState<CohortRanking[]>([]);
  
  // Get current user ID on mount (used for both feed and cohort)
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);
    };
    getCurrentUser();
  }, []);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [resetsOn, setResetsOn] = useState<string | null>(null);
  const [monthName, setMonthName] = useState<string | null>(null);
  const [loadingRankings, setLoadingRankings] = useState(false);
  const [errorRankings, setErrorRankings] = useState<string | null>(null);
  const [notInCohort, setNotInCohort] = useState(false);
  const isFetchingRankingsRef = useRef(false);
  const hasFetchedRankingsRef = useRef(false);

  // Handle inline post creation
  const handlePost = useCallback(async () => {
    if (!composerText.trim() || isPosting) {
      return;
    }

    setIsPosting(true);
    try {
      await createPost(composerText);
      setComposerText('');
    } catch (err) {
      console.error('[CommunityScreen] Error creating post:', err);
      // Error is handled by the hook
    } finally {
      setIsPosting(false);
    }
  }, [composerText, isPosting, createPost]);

  // Handle post deletion
  const handleDeletePost = useCallback((postId: string) => {
    Alert.alert(
      'Delete Post',
      'Delete this post? This can\'t be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePost(postId);
            } catch (err: any) {
              // Show user-friendly error
              const errorMessage = err?.message || 'Failed to delete post. Please try again.';
              Alert.alert('Error', errorMessage);
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, [deletePost]);

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
      } else if (selectedTab === 'feed') {
        // Feed tab: refetch when screen gains focus
        refetchFeed();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTab, refetchFeed])
  );

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
        await refetchFeed();
      }
    } finally {
      setRefreshing(false);
    }
  }, [selectedTab, fetchRankings, refetchFeed]);

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
              // Only switch and refetch if not already on feed tab
              if (selectedTab !== 'feed') {
                if (__DEV__) console.log('[CommunityScreen] Switching to Feed tab');
                setSelectedTab('feed');
                // Refetch feed if not currently loading (prevents spam)
                if (!loading) {
                  refetchFeed();
                }
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
              // Only switch and refetch if not already on cohort tab
              if (selectedTab !== 'cohort') {
                if (__DEV__) console.log('[CommunityScreen] Switching to Cohort tab');
                setSelectedTab('cohort');
                // Refetch cohort if not currently loading (prevents spam)
                if (!loadingRankings && !isFetchingRankingsRef.current) {
                  fetchRankings();
                }
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
              <Text style={styles.cohortExplanation}>
                Cohorts reset monthly. Rankings are based on task completion consistency.
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
            {/* Inline Post Composer */}
            <View style={styles.composerCard}>
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
                <View style={styles.composerInputContainer}>
                  <TextInput
                    style={styles.composerInput}
                    placeholder="What did you execute today?"
                    placeholderTextColor="#666"
                    value={composerText}
                    onChangeText={setComposerText}
                    multiline
                    maxLength={5000}
                    editable={!isPosting}
                  />
                  <TouchableOpacity
                    style={[
                      styles.composerPostButton,
                      (!composerText.trim() || isPosting) && styles.composerPostButtonDisabled,
                    ]}
                    onPress={handlePost}
                    disabled={!composerText.trim() || isPosting}
                    activeOpacity={0.7}>
                    {isPosting ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <Text style={styles.composerPostButtonText}>Post</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Posts List */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Error: {error}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={refetchFeed}>
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
                            {post.author_first_name || 'Someone'}
                          </Text>
                          <Text style={styles.postMeta}>
                            {formatPostTimestamp(post.created_at)}
                          </Text>
                        </View>
                      </View>
                      {/* Author-only delete menu */}
                      {currentUserId === post.author_id && (
                        <TouchableOpacity
                          style={styles.postMenuButton}
                          onPress={() => handleDeletePost(post.id)}
                          activeOpacity={0.7}>
                          <MaterialIcons
                            name="more-vert"
                            size={20}
                            color="#999"
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Post Content */}
                    <Text style={styles.postContent}>{post.body}</Text>

                    {/* Like Button */}
                    <View style={styles.postActions}>
                      <TouchableOpacity
                        style={styles.likeButton}
                        onPress={() => toggleLike(post.id, post.is_liked)}
                        activeOpacity={0.7}>
                        <MaterialIcons
                          name={post.is_liked ? 'thumb-up' : 'thumb-up-off-alt'}
                          size={20}
                          color={post.is_liked ? '#4CAF50' : '#999'}
                        />
                        {post.like_count > 0 && (
                          <Text style={[
                            styles.likeCount,
                            post.is_liked && styles.likeCountActive
                          ]}>
                            {post.like_count}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
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
    marginBottom: 8,
  },
  cohortExplanation: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
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
    alignItems: 'flex-start',
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
  composerInputContainer: {
    flex: 1,
  },
  composerInput: {
    fontSize: 16,
    color: '#fff',
    minHeight: 40,
    maxHeight: 120,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  composerPostButton: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  composerPostButtonDisabled: {
    opacity: 0.5,
  },
  composerPostButtonText: {
    fontSize: 14,
    color: '#000',
    fontWeight: '600',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  postHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  postMenuButton: {
    padding: 4,
    marginLeft: 8,
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
    marginBottom: 12,
  },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  likeCount: {
    fontSize: 14,
    color: '#999',
    marginLeft: 4,
  },
  likeCountActive: {
    color: '#4CAF50',
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
