import { bundledAddons, type InstalledAddon, listRoots } from '@lelap/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { confirmAddon } from '../addonInstall';
import { catalogBase, hostedAddons } from '../config';
import { db } from '../db';
import { showAlert } from '../dialog';
import { t } from '../i18n';
import { useLibrary } from '../player';
import { bundledScrobblers, scrobblersWork } from '../scrobblers';

type Offer = {
  key: string;
  name: string;
  description: string;
  /** The button: Set up for one that needs settings, Add for one that needs nothing. */
  action: string;
  /** The button's name for a screen reader, with the add-on's name. */
  actionLabel: string;
  /** Null where it can't be set up, such as a cookie login in a browser. */
  setUp: (() => void) | null;
  note: string | null;
};

type HostedId = (typeof hostedAddons)[number]['id'];

const NAMES: Record<HostedId, string> = {
  hardcover: 'Hardcover',
  gpodder: 'gPodder sync',
  bookwyrm: 'BookWyrm',
  lectures: 'Open lectures',
  lepak: 'Lepak',
};

// A function, so `t()` reads the listener's language when the offer is drawn.
const description = (id: HostedId): string =>
  ({
    hardcover: t(
      'Keeps your Hardcover shelves up to date as you listen, and shows your Want to read shelf, trending books and your lists.',
    ),
    gpodder: t(
      'Reports the episodes you play to a gPodder-compatible server, so other podcast apps continue where you stopped.',
    ),
    bookwyrm: t(
      'Shows your public BookWyrm shelves as rows: Want to read, Currently reading, Read and Stopped reading.',
    ),
    lectures: t(
      'Complete lecture courses from Open Yale Courses as books, one lecture per part, with Yale’s credit and licence on every course.',
    ),
    lepak: t(
      'Free podcasts in Malay and Indonesian, and from Singapore, from Podcast Index: stories in Cerita, talk in Sembang, history in Sejarah and Singapore shows in Singapura.',
    ),
  })[id];

/**
 * Library sources that come with the app and are offered here too, since a listener may not look
 * for them under “Add a server” (M128).
 */
const OWN_SOURCES = new Set(['app.lelap.opds']);

/**
 * Lelap's own optional add-ons not added yet: those that come with the app (the Open Library
 * reading log, OPDS), those on our catalog host that need the listener's account (Hardcover,
 * gPodder, BookWyrm) and those there that need nothing (Open lectures, Lepak).
 */
export function useOwnAddonOffers(
  addons: InstalledAddon[],
  { pasteAbove }: { pasteAbove: boolean },
): Offer[] {
  const router = useRouter();
  const { refresh } = useLibrary();
  const queryClient = useQueryClient();
  const add = async (manifestUrl: string) => {
    try {
      if ((await confirmAddon(manifestUrl)) === 'added') {
        refresh();
        void queryClient.invalidateQueries();
      }
    } catch (error) {
      showAlert(t('Cannot add'), error instanceof Error ? error.message : String(error));
    }
  };
  // A server without Podcast Index keys doesn't serve Lepak; its root lists what it does serve.
  // Unknown (offline, still loading): offer them all.
  const served = useQuery({
    queryKey: ['catalog-listing', catalogBase],
    queryFn: async (): Promise<string[] | null> => {
      const response = await fetch(`${catalogBase}/`);
      if (!response.ok) return null;
      const body = (await response.json()) as { addons?: unknown };
      return Array.isArray(body.addons)
        ? body.addons.filter((a): a is string => typeof a === 'string')
        : null;
    },
    staleTime: 60 * 60 * 1000,
    retry: false,
  }).data;
  const bundled = bundledScrobblers()
    .filter((s) => !addons.some((a) => a.url === s.url))
    .map<Offer>((s) => ({
      key: s.url,
      name: s.manifest.name,
      description: s.manifest.description,
      action: t('Set up'),
      actionLabel: t('Set up {name}', { name: s.manifest.name }),
      setUp: scrobblersWork
        ? () => router.push({ pathname: '/scrobbler', params: { url: s.url } })
        : null,
      note: scrobblersWork
        ? null
        : t(
            'This works in the Android app only: it signs in with a cookie, which a browser keeps from the page.',
          ),
    }));
  // Offered until one server of its kind is added; “Add a server” adds more.
  const servers = listRoots(db).flatMap((r) =>
    r.remote?.type === 'addon' ? [r.remote.addonUrl] : [],
  );
  const sources = bundledAddons()
    .filter((a) => OWN_SOURCES.has(a.manifest.id) && !servers.includes(a.url))
    .map<Offer>((a) => ({
      key: a.url,
      name: a.manifest.name,
      description: a.manifest.description,
      action: t('Set up'),
      actionLabel: t('Set up {name}', { name: a.manifest.name }),
      setUp: () => router.push({ pathname: '/server', params: { addon: a.url } }),
      note:
        Platform.OS === 'web'
          ? t('In the browser the server must allow this site (CORS) and use https.')
          : t('Runs on this phone, so it reaches a server on your home network.'),
    }));
  // Added once an installed add-on's link starts with the base.
  const hosted = hostedAddons
    .filter((h) => !addons.some((a) => a.url.startsWith(`${h.base}/`)))
    .filter((h) => h.setUp !== 'add' || !served || served.includes(`${h.base}/manifest.json`))
    .map<Offer>((h) =>
      h.setUp === 'add'
        ? {
            key: h.id,
            name: NAMES[h.id],
            description: description(h.id),
            action: t('Add'),
            actionLabel: t('Add {name}', { name: NAMES[h.id] }),
            setUp: () => void add(`${h.base}/manifest.json`),
            note: null,
          }
        : {
            key: h.id,
            name: NAMES[h.id],
            description: description(h.id),
            action: t('Set up'),
            actionLabel: t('Set up {name}', { name: NAMES[h.id] }),
            setUp: () => void Linking.openURL(`${h.base}/configure`),
            note:
              Platform.OS !== 'web'
                ? t('Opens a page on our server for your account; Lelap adds it when you are done.')
                : pasteAbove
                  ? t(
                      'Opens a page on our server for your account; paste the link it gives you above.',
                    )
                  : t(
                      'Opens a page on our server for your account; paste the link it gives you in Settings → Library and sources → Add-ons.',
                    ),
          },
    );
  return [...bundled, ...sources, ...hosted];
}

/** One offer: its name, a Set up or Add button, what it does and how setting it up works. */
export function OwnAddonOffer({ offer }: { offer: Offer }) {
  return (
    <View className="gap-1 border-b border-line py-4">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-base text-paper">{offer.name}</Text>
        {offer.setUp && (
          <Pressable
            onPress={offer.setUp}
            accessibilityRole="button"
            accessibilityLabel={offer.actionLabel}
            className="min-h-12 justify-center rounded-full border border-line px-3 active:bg-raised"
          >
            <Text className="text-sm text-amber">{offer.action}</Text>
          </Pressable>
        )}
      </View>
      <Text className="text-sm text-soft">{offer.description}</Text>
      {offer.note && <Text className="text-xs text-muted">{offer.note}</Text>}
    </View>
  );
}
