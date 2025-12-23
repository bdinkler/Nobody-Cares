import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';

const SUPPORT_EMAIL = 'support@nobodycares.app';

function buildMailtoUrl(): string {
  const appVersion = Constants.expoConfig?.version || '';
  const osName = Platform.OS;
  const osVersion = Platform.Version;
  const deviceModel = Platform.constants?.modelName || Platform.constants?.systemName || 'Unknown';

  const subject = encodeURIComponent('Nobody Cares Support');
  
  const bodyLines = [
    'App version: ' + (appVersion || ''),
    'Device: ' + deviceModel,
    'OS: ' + osName + ' ' + osVersion,
    'Issue: ',
    '',
  ];
  
  const body = encodeURIComponent(bodyLines.join('\n'));
  
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

export default function SupportScreen() {
  const handleEmailPress = async () => {
    const mailtoUrl = buildMailtoUrl();
    
    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      
      if (canOpen) {
        await Linking.openURL(mailtoUrl);
      } else {
        // If mailto: can't be opened, show alert with email address
        Alert.alert(
          'Email Not Available',
          `Please copy this email address:\n\n${SUPPORT_EMAIL}`,
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('[Support] Error opening email:', error);
      Alert.alert(
        'Error',
        `Unable to open email. Please contact us at:\n\n${SUPPORT_EMAIL}`,
        [{ text: 'OK' }]
      );
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
          <Text style={styles.headerTitle}>Support</Text>
        </View>

        {/* Instructions */}
        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionsText}>
            Need help, have a bug to report, or want to share feedback? Reach out to us via email.
          </Text>
        </View>

        {/* Email Button */}
        <TouchableOpacity
          style={styles.emailButton}
          onPress={handleEmailPress}
          activeOpacity={0.8}>
          <Text style={styles.emailButtonText}>Email {SUPPORT_EMAIL}</Text>
        </TouchableOpacity>

        {/* Email Text (also tappable) */}
        <TouchableOpacity
          onPress={handleEmailPress}
          activeOpacity={0.7}
          style={styles.emailTextContainer}>
          <Text style={styles.emailText}>{SUPPORT_EMAIL}</Text>
        </TouchableOpacity>

        {/* Helper Text */}
        <Text style={styles.helperText}>
          Please include your app version and a brief description of the issue.
        </Text>
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
    marginBottom: 24,
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
  instructionsContainer: {
    marginBottom: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  instructionsText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
    textAlign: 'center',
  },
  emailButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  emailButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  emailTextContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  emailText: {
    fontSize: 16,
    color: '#fff',
    textDecorationLine: 'underline',
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
  },
});

