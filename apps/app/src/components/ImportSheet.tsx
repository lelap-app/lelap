import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { showAlert } from '../dialog';
import { importAntennaPod, importGoodreads, importSmartAudiobook } from '../importers';
import { LOCAL_FOLDERS } from '../platform/library';
import { Sheet } from './Sheet';

const sources = () =>
  [
    {
      key: 'goodreads',
      label: 'Goodreads',
      detail: t(
        'The CSV from My Books → Import and export. Shelves become tags; read books are marked finished.',
      ),
    },
    {
      key: 'antennapod',
      label: 'AntennaPod',
      detail: t(
        'The database export (or OPML) from Settings → Import/Export. Subscriptions, played episodes and places.',
      ),
    },
    {
      key: 'sabp',
      label: 'Smart AudioBook Player',
      detail: t(
        'Reads the position files it keeps in each book folder of your audiobooks folder. Places and finished books.',
      ),
    },
  ] as const;

/** Picks another app's export and merges it into this profile. */
export function ImportSheet({
  visible,
  onClose,
  onImported,
}: {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: ReturnType<typeof sources>[number]['key']) => {
    setBusy(t('Reading the file…'));
    const work =
      key === 'goodreads'
        ? importGoodreads()
        : key === 'antennapod'
          ? importAntennaPod(setBusy)
          : importSmartAudiobook(setBusy);
    void work
      .then((imported) => {
        if (!imported) return;
        onImported();
        onClose();
      })
      .catch((error: unknown) =>
        showAlert(t('Import'), error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setBusy(null));
  };

  return (
    <Sheet
      visible={visible}
      title={t('Import from another app')}
      onClose={busy ? () => {} : onClose}
    >
      {busy ? (
        <Text accessibilityLiveRegion="polite" className="pb-6 text-muted">
          {busy}
        </Text>
      ) : (
        <View className="pb-2">
          {sources()
            .filter((s) => LOCAL_FOLDERS || s.key !== 'sabp')
            .map((source) => (
              <Pressable
                key={source.key}
                onPress={() => run(source.key)}
                accessibilityRole="button"
                className="gap-1 border-b border-line py-3 active:opacity-60"
              >
                <Text className="text-base text-paper">{source.label}</Text>
                <Text className="text-sm text-muted">{source.detail}</Text>
              </Pressable>
            ))}
          <Text className="py-3 text-xs text-muted">
            {t(
              'Nothing leaves this device; only podcast feeds are fetched, as when you subscribe.',
            )}
          </Text>
        </View>
      )}
    </Sheet>
  );
}
