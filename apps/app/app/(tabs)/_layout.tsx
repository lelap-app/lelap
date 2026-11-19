import { needsFirstStart, RAIL_WIDTH } from '@lelap/core';
import { Redirect } from 'expo-router';
import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { useAddons } from '../../src/addons';
import { db } from '../../src/db';
import { profileId } from '../../src/profile';
import { useSourceCacheAddons } from '../../src/availability';
import { COLORS, Icon, type IconName } from '../../src/components/Icon';
import { MiniPlayer } from '../../src/components/MiniPlayer';
import { RailLists } from '../../src/components/RailLists';
import { useWide } from '../../src/layout';

// React Navigation's tab bar is 49 points tall whatever the font size; this much more per
// step of the system font scale keeps the labels whole at the largest sizes.
const TAB_BAR = 49;
const LABEL_GROWTH = 16;
// The web squeezes the label to 10 of its 12 points in a 49-point bar, cutting off the y of
// Library; a little more room keeps it whole.
const WEB_EXTRA = Platform.OS === 'web' ? 4 : 0;

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
  // On a tablet or a laptop the tabs become a rail along the start edge.
  const wide = useWide();
  // Asked once as the tabs open: a device with nothing in it starts with the welcome (M82).
  const [firstStart] = useState(() => needsFirstStart(db, profileId));
  const tall =
    (fontScale > 1 || WEB_EXTRA > 0) && !wide
      ? {
          height:
            Math.round(TAB_BAR + WEB_EXTRA + LABEL_GROWTH * Math.max(0, fontScale - 1)) +
            insets.bottom,
        }
      : {};
  if (firstStart) return <Redirect href="/welcome" />;
  return (
    <Tabs
      tabBar={(props) =>
        wide ? (
          // The rail: the tabs, then the lists, which take a dragged book or episode (M113).
          <View
            style={{ width: RAIL_WIDTH, paddingBottom: insets.bottom }}
            className="border-e border-line bg-raised"
          >
            <BottomTabBar {...props} />
            <RailLists />
          </View>
        ) : (
          <View>
            <MiniPlayer inset={false} />
            <BottomTabBar {...props} />
          </View>
        )
      }
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: COLORS.night },
        ...(wide
          ? {
              tabBarPosition: 'left' as const,
              tabBarVariant: 'material' as const,
              tabBarLabelPosition: 'below-icon' as const,
            }
          : {}),
        tabBarStyle: wide
          ? // The rail's box draws the background and the line; the tabs keep to their height.
            {
              backgroundColor: COLORS.raised,
              borderWidth: 0,
              flexGrow: 0,
              minWidth: 0,
              paddingBottom: 8,
            }
          : { backgroundColor: COLORS.raised, borderTopColor: COLORS.line, ...tall },
        tabBarActiveTintColor: COLORS.amber,
        tabBarInactiveTintColor: COLORS.muted,
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
