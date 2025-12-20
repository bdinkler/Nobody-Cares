import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#000' },
        headerTintColor: '#fff',
        headerTitleStyle: { color: '#fff' },
      }}
    >
      <Stack.Screen name="edit" options={{ title: 'Edit Profile' }} />
      <Stack.Screen name="tasks" options={{ title: 'Manage Tasks' }} />
      <Stack.Screen name="feedback" options={{ title: 'Give Feedback' }} />
      <Stack.Screen name="support" options={{ title: 'Support / Contact' }} />
    </Stack>
  );
}

