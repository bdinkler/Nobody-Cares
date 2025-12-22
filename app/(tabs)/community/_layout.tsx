import { Stack } from 'expo-router';

export default function CommunityLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#000' },
        headerTintColor: '#fff',
        headerTitleStyle: { color: '#fff' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new-post" options={{ title: 'New Post', presentation: 'modal' }} />
      <Stack.Screen name="cohort" options={{ title: 'Cohort' }} />
    </Stack>
  );
}

