// Graceful fallback to in-memory storage if AsyncStorage is unavailable
let AsyncStorage: any = null;
let inMemorySubscription: boolean = false;
let inMemoryEarlyAccessAck: boolean = false;

try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (error) {
  console.warn('[Subscription] AsyncStorage not available, using in-memory fallback');
}

const DEV_SUBSCRIBED_KEY = 'dev_subscribed';
const DEV_EARLY_ACCESS_ACK_KEY = 'dev_early_access_ack';

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

/**
 * Get early access acknowledgement status
 * Uses AsyncStorage if available, falls back to in-memory variable
 * Defaults to false if not set
 */
export async function getEarlyAccessAck(): Promise<boolean> {
  if (AsyncStorage) {
    try {
      const value = await AsyncStorage.getItem(DEV_EARLY_ACCESS_ACK_KEY);
      return value === 'true';
    } catch (error) {
      console.error('[Subscription] Error reading early access ack:', error);
      return inMemoryEarlyAccessAck;
    }
  }
  // Fallback to in-memory
  return inMemoryEarlyAccessAck;
}

/**
 * Set early access acknowledgement status
 * Uses AsyncStorage if available, falls back to in-memory variable
 */
export async function setEarlyAccessAck(value: boolean): Promise<void> {
  if (AsyncStorage) {
    try {
      await AsyncStorage.setItem(DEV_EARLY_ACCESS_ACK_KEY, value ? 'true' : 'false');
      inMemoryEarlyAccessAck = value;
      console.log('[Subscription] early access ack set to', value);
      return;
    } catch (error) {
      console.error('[Subscription] Error saving early access ack, using in-memory:', error);
      // Fall through to in-memory fallback
    }
  }
  // Fallback to in-memory
  inMemoryEarlyAccessAck = value;
  console.log('[Subscription] early access ack set to', value, '(in-memory)');
}

/**
 * Reset all dev state (dev only)
 * Clears all dev_* keys from AsyncStorage and resets in-memory variables
 * This is for testing purposes only and should be guarded by __DEV__
 */
export async function resetDevState(): Promise<void> {
  if (!__DEV__) {
    console.warn('[Subscription] resetDevState called in production - ignoring');
    return;
  }

  // Reset in-memory variables
  inMemorySubscription = false;
  inMemoryEarlyAccessAck = false;

  if (!AsyncStorage) {
    console.log('[Subscription] AsyncStorage not available, reset in-memory only');
    return;
  }

  try {
    // Get all keys from AsyncStorage
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Filter for dev_* keys
    const devKeys = allKeys.filter(key => key.startsWith('dev_'));
    
    // Remove all dev_* keys
    if (devKeys.length > 0) {
      await AsyncStorage.multiRemove(devKeys);
      console.log('[Subscription] Reset dev state: removed keys:', devKeys);
    } else {
      console.log('[Subscription] Reset dev state: no dev keys found');
    }
  } catch (error) {
    console.error('[Subscription] Error resetting dev state:', error);
    throw error;
  }
}

