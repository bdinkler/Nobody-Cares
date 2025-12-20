// Graceful fallback to in-memory storage if AsyncStorage is unavailable
let AsyncStorage: any = null;
let inMemorySubscription: boolean = false;

try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (error) {
  console.warn('[Subscription] AsyncStorage not available, using in-memory fallback');
}

const DEV_SUBSCRIBED_KEY = 'dev_subscribed';

/**
 * Get subscription status (dev only)
 * Uses AsyncStorage if available, falls back to in-memory variable
 * Defaults to false if not set
 */
export async function getIsSubscribed(): Promise<boolean> {
  if (AsyncStorage) {
    try {
      const value = await AsyncStorage.getItem(DEV_SUBSCRIBED_KEY);
      return value === 'true';
    } catch (error) {
      console.error('[Subscription] Error reading subscription:', error);
      return inMemorySubscription;
    }
  }
  // Fallback to in-memory
  return inMemorySubscription;
}

/**
 * Set subscription status (dev only)
 * Uses AsyncStorage if available, falls back to in-memory variable
 */
export async function setSubscribed(value: boolean): Promise<void> {
  if (AsyncStorage) {
    try {
      await AsyncStorage.setItem(DEV_SUBSCRIBED_KEY, value ? 'true' : 'false');
      inMemorySubscription = value;
      console.log('[Subscription] dev subscribed set to', value);
      return;
    } catch (error) {
      console.error('[Subscription] Error saving subscription, using in-memory:', error);
      // Fall through to in-memory fallback
    }
  }
  // Fallback to in-memory
  inMemorySubscription = value;
  console.log('[Subscription] dev subscribed set to', value, '(in-memory)');
}

