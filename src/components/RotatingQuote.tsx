import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { QUOTES, type Quote } from '@/src/content/quotes';

const ROTATION_INTERVAL = 5500; // 5.5 seconds

export default function RotatingQuote() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentQuote = QUOTES[currentIndex];

  const advanceQuote = useCallback(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setCurrentIndex((prev) => (prev + 1) % QUOTES.length);
  }, [fadeAnim]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      advanceQuote();
    }, ROTATION_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [advanceQuote]);

  const handleTap = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    advanceQuote();
    intervalRef.current = setInterval(() => {
      advanceQuote();
    }, ROTATION_INTERVAL);
  }, [advanceQuote]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handleTap}
      style={styles.container}
    >
      <Animated.View style={[styles.quoteContainer, { opacity: fadeAnim }]}>
        <Text style={styles.quoteText}>"{currentQuote.text}"</Text>
        <Text style={styles.author}>— {currentQuote.author}</Text>
        <Text style={styles.tag}>{currentQuote.tag}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 400,
    marginVertical: 24,
  },
  quoteContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  quoteText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 24,
  },
  author: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 8,
  },
  tag: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

