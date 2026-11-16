import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

import { useDbReady } from '../src/db';

export default function RootLayout() {
  const { ready, error } = useDbReady();

  if (error) {
    return (
      <View className="flex-1 justify-center bg-night p-6">
        <Text className="text-danger">Lelap could not open its library: {error.message}</Text>
      </View>
    );
  }
  if (!ready) return <View className="flex-1 bg-night" />;

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0e11' } }} />
      <StatusBar style="light" />
    </>
  );
}
