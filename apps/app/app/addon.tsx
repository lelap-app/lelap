import { parseAddonLink } from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { t } from '../src/i18n';
import { confirmAddon } from '../src/addonInstall';
import { useLibrary } from '../src/player';
import { activeProfile } from '../src/profile';

/**
 * `lelap://addon?manifest=…` (and `/addon?manifest=…` on the web): where an add-on's configure page
 * sends the listener with the manifest URL that carries their settings.
 */
export default function AddonLinkScreen() {
  const router = useRouter();
  const { refresh } = useLibrary();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ manifest?: string }>();
  const raw = typeof params.manifest === 'string' ? params.manifest : '';
  const manifestUrl = raw
    ? parseAddonLink(`lelap://addon?manifest=${encodeURIComponent(raw)}`)
    : null;
  const kids = activeProfile()?.kids === true;
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !manifestUrl || kids) return;
    started.current = true;
    confirmAddon(manifestUrl)
      .then((result) => {
        if (result === 'added') {
          refresh();
          void queryClient.invalidateQueries();
        }
        router.replace('/addons');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [manifestUrl, kids, refresh, queryClient, router]);

  const message = kids
    ? t('Ask a grown-up to change add-ons.')
    : !manifestUrl
      ? t('This link has no add-on address in it.')
      : error;

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-night p-8">
      {message === null ? (
        <>
          <ActivityIndicator color="#f5b041" />
          <Text className="text-soft">{t('Opening the add-on…')}</Text>
        </>
      ) : (
        <>
          <Text className="text-center text-paper">{message}</Text>
          <Pressable onPress={() => router.replace('/addons')} accessibilityRole="button">
            <Text className="text-amber">{t('Add-ons')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
