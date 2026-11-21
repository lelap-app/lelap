import { parseAddonLink } from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { t } from '../src/i18n';
import { confirmAddon } from '../src/addonInstall';
import { useLibrary } from '../src/player';
import { activeProfile } from '../src/profile';
import { LoadState } from '../src/components/LoadState';
import { TextButton } from '../src/components/TextButton';

/**
 * `lelap://addon?manifest=…` (and `/addon?manifest=…` on the web): where an add-on's configure page
 * sends the listener with the manifest URL that carries their settings. A passing screen with one
 * line, read as it changes, so it has no heading (a11y: no heading).
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
  // Try again bumps this, so the effect asks once more; an older attempt that answers late is
  // ignored, so it can't open a second question.
  const [attempt, setAttempt] = useState(0);
  const current = useRef(0);
  // While the manifest is fetched; the question that follows may stay open as long as it likes.
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (started.current || !manifestUrl || kids) return;
    started.current = true;
    const mine = ++current.current;
    setFetching(true);
    confirmAddon(manifestUrl, false, () => {
      if (mine !== current.current) return false;
      setFetching(false);
      return true;
    })
      .then((result) => {
        if (mine !== current.current) return;
        if (result === 'added') {
          refresh();
          void queryClient.invalidateQueries();
        }
        router.replace('/addons');
      })
      .catch((e: unknown) => {
        if (mine !== current.current) return;
        setFetching(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [manifestUrl, kids, refresh, queryClient, router, attempt]);

  const message = kids
    ? t('Ask a grown-up to change add-ons.')
    : !manifestUrl
      ? t('This link has no add-on address in it.')
      : null;

  const retry = () => {
    started.current = false;
    setError(null);
    setAttempt((n) => n + 1);
  };

  // Loading only while the manifest is fetched: the add-on's own question that follows opens over
  // this screen and may stay open past the load timeout.
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-night p-8">
      <LoadState
        loading={fetching && message === null && error === null}
        failed={
          message !== null
            ? { title: message }
            : error !== null && { title: t('Cannot add'), body: error }
        }
        onRetry={message === null ? retry : undefined}
      >
        <Text accessibilityLiveRegion="polite" className="text-soft">
          {t('Opening the add-on…')}
        </Text>
      </LoadState>
      {(message !== null || error !== null) && (
        <TextButton text={t('Add-ons')} onPress={() => router.replace('/addons')} />
      )}
    </View>
  );
}
