import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      initialRouteName="ownership"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ownership" />
      <Stack.Screen name="vision" />
      <Stack.Screen name="commitments" />
      <Stack.Screen name="rules" />
    </Stack>
  );
}

