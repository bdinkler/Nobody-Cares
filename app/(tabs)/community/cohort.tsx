import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
} from 'react-native';

export default function CohortScreen() {
  const getMonthName = (): string => {
    return new Date().toLocaleDateString('en-US', { month: 'long' });
  };

  const getNextMonthName = (): string => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.toLocaleDateString('en-US', { month: 'long' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{getMonthName()} Cohort</Text>
          <Text style={styles.subtitle}>20 members • Resets {getNextMonthName()} 1</Text>
        </View>

        {/* Rankings Placeholder */}
        <View style={styles.rankingsContainer}>
          <Text style={styles.rankingsLabel}>Rankings (coming next)</Text>
          <Text style={styles.rankingsPlaceholder}>
            Cohort rankings will be displayed here in a future update.
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
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#999',
  },
  rankingsContainer: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  rankingsLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  rankingsPlaceholder: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});

