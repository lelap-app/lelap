import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { Text, View } from 'react-native';

import { MiniPlayer } from '../../src/components/MiniPlayer';

const ICONS: Record<string, string> = {
  index: '⌂',
  discover: '◎',
  search: '⌕',
  podcasts: '◉',
  library: '▤',
};

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => (
        <View>
          <MiniPlayer inset={false} />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: '#0d0e11' },
        tabBarStyle: { backgroundColor: '#17191e', borderTopColor: '#33353b' },
        tabBarActiveTintColor: '#f5b041',
        tabBarInactiveTintColor: '#8d8a83',
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{ICONS[route.name] ?? '•'}</Text>
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="podcasts" options={{ title: 'Podcasts' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
    </Tabs>
  );
}
