import { RAIL_WIDTH } from '@lelap/core';
import { type Href, usePathname, useRouter } from 'expo-router';
import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { useColors } from '../theme';
import { Icon, type IconName } from './Icon';
import { RailLists } from './RailLists';

const TABS: { href: Href & string; icon: IconName; label: () => string }[] = [
  { href: '/', icon: 'home', label: () => t('Home') },
  { href: '/discover', icon: 'discover', label: () => t('Discover') },
  { href: '/search', icon: 'search', label: () => t('Search') },
  { href: '/podcasts', icon: 'podcast', label: () => t('Podcasts') },
  { href: '/library', icon: 'library', label: () => t('Library') },
];

// Screens that fill the window by themselves: the welcome, car mode and the full player.
const BARE = new Set(['/welcome', '/car', '/player']);

function RailItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const color = active ? colors.amber : colors.muted;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      className="min-h-14 min-w-12 items-center justify-center gap-1 rounded-xl px-1 py-2 active:bg-night"
    >
      <Icon name={icon} color={color} />
      {/* Two lines rather than an ellipsis, so a long name in another language stays whole. */}
      <Text
        numberOfLines={2}
        className={`text-center text-caption ${active ? 'text-amber' : 'text-soft'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The desktop and tablet rail (M149): the five tabs, the lists, and Settings at its foot. It
 * stands beside every screen, a book's page and Settings too, not only beside the tabs.
 */
export function Rail() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // On a pushed screen the tab underneath stays lit: it is where Back goes.
  const last = useRef<string>('/');
  if (TABS.some((tab) => tab.href === pathname)) last.current = pathname;
  if (BARE.has(pathname)) return null;
  const settings = pathname.startsWith('/settings');
  return (
    <View
      accessibilityRole="tablist"
      style={{ width: RAIL_WIDTH, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }}
      className="gap-1 border-e border-line bg-raised px-2"
    >
      {TABS.map((tab) => (
        <RailItem
          key={tab.href}
          icon={tab.icon}
          label={tab.label()}
          active={!settings && last.current === tab.href}
          onPress={() => router.navigate(tab.href)}
        />
      ))}
      <View className="flex-1">
        <RailLists />
      </View>
      <RailItem
        icon="settings"
        label={t('Settings')}
        active={settings}
        onPress={() => router.navigate('/settings')}
      />
    </View>
  );
}
