import { useState, useEffect, useRef } from 'react';

export type SubscriptionStatus = 'loading' | 'active' | 'inactive' | 'error';

// Types for RevenueCat (will be available after package installation)
type CustomerInfo = any;
type PurchasesPackage = any;

let Purchases: any = null;
try {
  Purchases = require('react-native-purchases').default;
} catch (error) {
  console.warn('[Subscription] RevenueCat not installed. Run: npm install react-native-purchases');
}

export function useSubscriptionStatus() {
  const [status, setStatus] = useState<SubscriptionStatus>('loading');
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }

    const initializeRevenueCat = async () => {
      try {
        // If RevenueCat is not installed, default to inactive (blocking)
        if (!Purchases) {
          console.warn('[Subscription] RevenueCat not installed. Defaulting to inactive (blocking access).');
          setStatus('inactive');
          return;
        }

        // Initialize RevenueCat
        // Note: Replace with your actual RevenueCat API key from environment variables
        const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
        
        if (!apiKey) {
          console.warn('[Subscription] RevenueCat API key not found. Defaulting to inactive (blocking access).');
          setStatus('inactive');
          return;
        }

        await Purchases.configure({ apiKey });
        
        // Get customer info
        const info = await Purchases.getCustomerInfo();
        setCustomerInfo(info);
        
        // Check if user has active entitlement
        const hasActiveSubscription = info.entitlements.active['premium'] !== undefined;
        setStatus(hasActiveSubscription ? 'active' : 'inactive');
        
        // Listen for updates
        Purchases.addCustomerInfoUpdateListener((updatedInfo: CustomerInfo) => {
          setCustomerInfo(updatedInfo);
          const hasActive = updatedInfo.entitlements.active['premium'] !== undefined;
          setStatus(hasActive ? 'active' : 'inactive');
        });
        
        hasInitializedRef.current = true;
      } catch (error) {
        console.error('[Subscription] Error initializing RevenueCat:', error);
        setStatus('error');
      }
    };

    initializeRevenueCat();
  }, []);

  const restorePurchases = async () => {
    if (!Purchases) {
      console.warn('[Subscription] RevenueCat not installed.');
      return false;
    }

    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const hasActive = info.entitlements.active['premium'] !== undefined;
      setStatus(hasActive ? 'active' : 'inactive');
      return hasActive;
    } catch (error) {
      console.error('[Subscription] Error restoring purchases:', error);
      return false;
    }
  };

  return {
    status,
    customerInfo,
    restorePurchases,
    hasActiveSubscription: status === 'active',
  };
}

