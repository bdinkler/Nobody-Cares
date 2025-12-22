import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  Platform,
  Linking,
} from 'react-native';
import { router } from 'expo-router';

// Placeholder subscription data structure (will be replaced with RevenueCat later)
type SubscriptionData = {
  isEntitled: boolean;
  productId: string | null;
  expirationDate: string | null;
  willRenew: boolean | null;
  managementUrl: string | null;
};

export default function SubscriptionScreen() {
  // Placeholder state - will be replaced with RevenueCat hook later
  const [subscriptionData] = useState<SubscriptionData>({
    isEntitled: false,
    productId: null,
    expirationDate: null,
    willRenew: null,
    managementUrl: null,
  });

  const handleManageSubscription = async () => {
    // If managementUrl exists (from RevenueCat), use it
    if (subscriptionData.managementUrl) {
      const canOpen = await Linking.canOpenURL(subscriptionData.managementUrl);
      if (canOpen) {
        await Linking.openURL(subscriptionData.managementUrl);
        return;
      }
    }

    // Fallback to platform-specific subscription management
    let url: string | null = null;

    if (Platform.OS === 'ios') {
      // iOS subscription management deep link
      url = 'https://apps.apple.com/account/subscriptions';
    } else if (Platform.OS === 'android') {
      // Android Google Play subscriptions deep link
      url = 'https://play.google.com/store/account/subscriptions';
    }

    if (url) {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Manage Subscription',
          Platform.OS === 'ios'
            ? 'Please go to Settings > [Your Name] > Subscriptions to manage your subscription.'
            : 'Please open Google Play Store > Menu > Subscriptions to manage your subscription.',
          [{ text: 'OK' }]
        );
      }
    } else {
      Alert.alert(
        'Manage Subscription',
        'Please manage your subscription through your device\'s app store settings.',
        [{ text: 'OK' }]
      );
    }
  };

  // Format expiration date for display
  const formatExpirationDate = (dateString: string | null): string => {
    if (!dateString) return '—';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  // Get status display text
  const getStatusText = (): string => {
    if (subscriptionData.isEntitled) {
      return 'Active';
    }
    return 'Not connected';
  };

  // Get plan display text
  const getPlanText = (): string => {
    if (subscriptionData.productId) {
      return subscriptionData.productId;
    }
    return '—';
  };

  // Get renewal/expiration text
  const getRenewalText = (): string => {
    if (!subscriptionData.expirationDate) {
      return '—';
    }
    if (subscriptionData.willRenew) {
      return `Renews ${formatExpirationDate(subscriptionData.expirationDate)}`;
    } else {
      return `Expires ${formatExpirationDate(subscriptionData.expirationDate)}`;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            activeOpacity={0.7}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
        </View>

        {/* Section A: Your Subscription */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Subscription</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={styles.infoValue}>{getStatusText()}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Plan</Text>
              <Text style={styles.infoValue}>{getPlanText()}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Renews / Expires</Text>
              <Text style={styles.infoValue}>{getRenewalText()}</Text>
            </View>
          </View>
          <Text style={styles.helperText}>
            Subscription details will appear here once billing is enabled.
          </Text>
        </View>

        {/* Section B: Manage */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.manageButton}
            onPress={handleManageSubscription}
            activeOpacity={0.7}>
            <View style={styles.manageButtonContent}>
              <Text style={styles.manageButtonText}>Manage / Cancel Subscription</Text>
              <Text style={styles.manageButtonSubtext}>Manage billing through your app store</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Section C: Help Text */}
        <View style={styles.helpSection}>
          <Text style={styles.helpText}>
            Cancelling your subscription does not delete your account or data.
          </Text>
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
  header: {
    marginBottom: 32,
  },
  backButton: {
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  infoLabel: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  manageButtonContent: {
    flex: 1,
    marginRight: 12,
  },
  manageButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
    marginBottom: 4,
  },
  manageButtonSubtext: {
    fontSize: 12,
    color: '#666',
  },
  chevron: {
    fontSize: 24,
    color: '#666',
    fontWeight: '300',
  },
  helpSection: {
    marginTop: 8,
    paddingTop: 16,
  },
  helpText: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    textAlign: 'center',
  },
});

