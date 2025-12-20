import React, { createContext, useContext, ReactNode } from 'react';

type OnboardingContextType = {
  refresh: () => void;
};

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children, refresh }: { children: ReactNode; refresh: () => void }) {
  return <OnboardingContext.Provider value={{ refresh }}>{children}</OnboardingContext.Provider>;
}

export function useOnboardingRefresh() {
  const context = useContext(OnboardingContext);
  if (!context) {
    return { refresh: () => {} }; // No-op if not in provider
  }
  return context;
}

