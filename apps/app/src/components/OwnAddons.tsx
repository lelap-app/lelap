import type { InstalledAddon } from '@lelap/core';
import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { hostedAddons } from '../config';
import { t } from '../i18n';
import { bundledScrobblers, scrobblersWork } from '../scrobblers';

type Offer = {
  key: string;
  name: string;
  description: string;
  /** Null where it can't be set up, such as a cookie login in a browser. */
  setUp: (() => void) | null;
  note: string | null;
};

/**
 * Lelap's own optional add-ons not added yet: those that come with the app (the Open Library
 * reading log) and those on our catalog host that need the listener's account (Hardcover, gPodder).
 */
export function useOwnAddonOffers(
  addons: InstalledAddon[],
  { pasteBelow }: { pasteBelow: boolean },
): Offer[] {
  const router = useRouter();
  const bundled = bundledScrobblers()
    .filter((s) => !addons.some((a) => a.url === s.url))
    .map<Offer>((s) => ({
      key: s.url,
      name: s.manifest.name,
      description: s.manifest.description,
      setUp: scrobblersWork
        ? () => router.push({ pathname: '/scrobbler', params: { url: s.url } })
        : null,
      note: scrobblersWork
        ? null
        : t(
            'This works in the Android app only: it signs in with a cookie, which a browser keeps from the page.',
          ),
    }));
  // Added once an installed add-on's link starts with the base.
  const hosted = hostedAddons
    .filter((h) => !addons.some((a) => a.url.startsWith(`${h.base}/`)))
    .map<Offer>((h) => ({
      key: h.id,
      name: h.id === 'hardcover' ? 'Hardcover' : 'gPodder sync',
      description:
        h.id === 'hardcover'
          ? t(
              'Keeps your Hardcover shelves up to date as you listen, and shows your Want to read shelf, trending books and your lists.',
            )
          : t(
              'Reports the episodes you play to a gPodder-compatible server, so other podcast apps continue where you stopped.',
            ),
      setUp: () => void Linking.openURL(`${h.base}/configure`),
      note:
        Platform.OS !== 'web'
          ? t('Opens a page on our server for your account; Lelap adds it when you are done.')
          : pasteBelow
            ? t('Opens a page on our server for your account; paste the link it gives you below.')
            : t(
                'Opens a page on our server for your account; paste the link it gives you in Settings → Add-ons.',
              ),
    }));
  return [...bundled, ...hosted];
}

/** One offer: its name, a Set up button, what it does and how setting it up works. */
export function OwnAddonOffer({ offer }: { offer: Offer }) {
  return (
    <View className="gap-1 border-b border-line py-4">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-base text-paper">{offer.name}</Text>
        {offer.setUp && (
          <Pressable
            onPress={offer.setUp}
            accessibilityRole="button"
            accessibilityLabel={t('Set up {name}', { name: offer.name })}
            className="min-h-12 justify-center rounded-full border border-line px-3 active:bg-raised"
          >
            <Text className="text-sm text-amber">{t('Set up')}</Text>
          </Pressable>
        )}
      </View>
      <Text className="text-sm text-soft">{offer.description}</Text>
      {offer.note && <Text className="text-xs text-muted">{offer.note}</Text>}
    </View>
  );
}
