import { parseAddonLink } from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { t } from '../src/i18n';
import { confirmAddon } from '../src/addonInstall';
import { useLibrary } from '../src/player';
import { activeProfile } from '../src/profile';
import { TextButton } from '../src/components/TextButton';
import { useColors } from '../src/theme';

/**
 * `lelap://addon?manifest=…` (and `/addon?manifest=…` on the web): where an add-on's configure page
 * sends the listener with the manifest URL that carries their settings. A passing screen with one
 * line, read as it changes, so it has no heading (a11y: no heading).
 */
export default function AddonLinkScreen() {
  const colors = useColors();
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
          <ActivityIndicator color={colors.amber} />
          <Text accessibilityLiveRegion="polite" className="text-soft">
            {t('Opening the add-on…')}
          </Text>
        </>
      ) : (
        <>
          <Text accessibilityLiveRegion="polite" className="text-center text-paper">
            {message}
          </Text>
          <TextButton text={t('Add-ons')} onPress={() => router.replace('/addons')} />
        </>
      )}
    </View>
  );
}
