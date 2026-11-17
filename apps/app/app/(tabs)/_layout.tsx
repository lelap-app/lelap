import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { t } from '../../src/i18n';
import { useAddons } from '../../src/addons';
import { useSourceCacheAddons } from '../../src/availability';
import { Icon, type IconName } from '../../src/components/Icon';
import { MiniPlayer } from '../../src/components/MiniPlayer';

const ICONS: Record<string, IconName> = {
  index: 'home',
  discover: 'discover',
  search: 'search',
  podcasts: 'podcast',
  library: 'library',
};

export default function TabsLayout() {
  useSourceCacheAddons(useAddons());
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
          <Icon name={ICONS[route.name] ?? 'home'} color={String(color)} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: t('Home') }} />
      <Tabs.Screen name="discover" options={{ title: t('Discover') }} />
      <Tabs.Screen name="search" options={{ title: t('Search') }} />
      <Tabs.Screen name="podcasts" options={{ title: t('Podcasts') }} />
      <Tabs.Screen name="library" options={{ title: t('Library') }} />
    </Tabs>
  );
}
