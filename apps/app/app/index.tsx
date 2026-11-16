import { schema } from '@lelap/core';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { db } from '../src/db';

export default function Library() {
  const profile = db.select().from(schema.profiles).get();
  return (
    <View className="flex-1 justify-center gap-4 bg-night p-6">
      <Text className="text-2xl text-paper">Library</Text>
      <Text className="text-soft">Profile: {profile?.name ?? 'none'}</Text>
      <Link href="/dev/spike" className="text-amber">
        Audio spike
      </Link>
    </View>
  );
}
