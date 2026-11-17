import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { useAddons } from '../../src/addons';
import { useSourceCacheAddons } from '../../src/availability';
import { Icon, type IconName } from '../../src/components/Icon';
import { MiniPlayer } from '../../src/components/MiniPlayer';

// React Navigation's tab bar is 49 points tall whatever the font size; this much more per
// step of the system font scale keeps the labels whole at the largest sizes.
const TAB_BAR = 49;
const LABEL_GROWTH = 16;

const ICONS: Record<string, IconName> = {
  index: 'home',
  discover: 'discover',
  search: 'search',
  podcasts: 'podcast',
  library: 'library',
};

export default function TabsLayout() {
  useSourceCacheAddons(useAddons());
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tall =
    fontScale > 1
      ? { height: Math.round(TAB_BAR + LABEL_GROWTH * (fontScale - 1)) + insets.bottom }
      : {};
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
        tabBarStyle: { backgroundColor: '#17191e', borderTopColor: '#33353b', ...tall },
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
