import { addonPermissions, type Permission } from '@lelap/core';
import type { Manifest } from '@lelap/sdk';
import { useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from './i18n';
import { COLORS, Icon, type IconName } from './components/Icon';
import { Sheet } from './components/Sheet';

// The sheet shown before an add-on is installed, and from its menu later: what it can do, in plain
// words, with what deserves a second look in amber. Add-ons are run by others; this is the moment
// the listener decides whether to trust one.

const ICONS: Record<Permission['kind'], IconName> = {
  catalog: 'library',
  meta: 'chapters',
  stream: 'play',
  artwork: 'discover',
  library: 'library',
  login: 'lock',
  scrobble: 'stats',
  settings: 'lock',
  insecure: 'close',
  host: 'cloud',
  sandbox: 'lock',
};

type Review = {
  manifest: Manifest;
  url: string;
  /** Null: shown for information, with Close only. */
  action: string | null;
  /** A small line under the list, such as the code's fingerprint. */
  note: string | undefined;
  resolve: (accepted: boolean) => void;
};

let current: Review | null = null;
const listeners = new Set<() => void>();
const set = (next: Review | null) => {
  current = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Shows what an add-on can do; resolves true when the listener presses `action`. */
export function reviewAddon(
  manifest: Manifest,
  url: string,
  action: string | null,
  note?: string,
): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => set({ manifest, url, action, note, resolve }));
}

/** Mounted once at the root. */
export function AddonReviewHost() {
  const review = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  if (!review) return null;
  const close = (accepted: boolean) => {
    set(null);
    review.resolve(accepted);
  };
  const { manifest, url, action, note } = review;

  return (
    <Sheet
      visible
      title={action ? t('{action} {name}?', { action, name: manifest.name }) : manifest.name}
      onClose={() => close(false)}
    >
      <ScrollView>
        {manifest.description !== '' && (
          <Text className="pb-3 text-soft">{manifest.description}</Text>
        )}
        <Text
          accessibilityRole="header"
          className="pb-2 text-xs uppercase tracking-wider text-muted"
        >
          {t('What it can do')}
        </Text>
        <View className="gap-3 pb-4">
          {addonPermissions(manifest, url).map((p) => (
            <View key={p.kind} className="flex-row gap-3">
              <Icon name={ICONS[p.kind]} size={20} color={p.notable ? COLORS.amber : COLORS.soft} />
              <Text className={`flex-1 text-sm ${p.notable ? 'text-amber' : 'text-paper'}`}>
                {p.text}
              </Text>
            </View>
          ))}
        </View>
        {note !== undefined && <Text className="pb-2 text-xs text-muted">{note}</Text>}
        <Text className="pb-4 text-xs text-muted">
          {t('Add-ons are made by their authors, not by Lelap. Only add ones you trust.')}
        </Text>
        <View className="flex-row justify-end gap-2 pb-2">
          <Pressable
            onPress={() => close(false)}
            accessibilityRole="button"
            className="min-h-12 justify-center rounded-full px-4 active:bg-line"
          >
            <Text className="font-semibold text-muted">{action ? t('Cancel') : t('Close')}</Text>
          </Pressable>
          {action && (
            <Pressable
              onPress={() => close(true)}
              accessibilityRole="button"
              className="min-h-12 justify-center rounded-full bg-amber px-5 active:opacity-80"
            >
              <Text className="font-semibold text-ink">{action}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}
