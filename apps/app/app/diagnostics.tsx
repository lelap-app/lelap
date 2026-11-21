import { diagnosticsReport, DIAGNOSTICS_LIMIT, getSettings } from '@lelap/core';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addonHealth } from '../src/addons';
import { db } from '../src/db';
import { isDiagnosticsOn, pullPlayerEvents, setDiagnostics } from '../src/diagnostics';
import { showAlert } from '../src/dialog';
import { t } from '../src/i18n';
import { READABLE, useWide } from '../src/layout';
import { shareText } from '../src/platform/files';
import { activeProfile, profileId } from '../src/profile';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { RowLabel, TextButton, Toggle } from '../src/components/TextButton';

async function buildReport(): Promise<string> {
  await pullPlayerEvents();
  const web = Platform.OS === 'web';
  return diagnosticsReport(db, {
    app: {
      version: Constants.expoConfig?.version ?? '?',
      platform: web ? 'web' : 'android',
      androidApi: web ? null : Number(Platform.Version),
    },
    settings: getSettings(db, profileId),
    health: (url) => addonHealth.get(url),
    now: Date.now(),
  });
}

/** Diagnostics (M47): an opt-in log on this device, shown in full before it is shared. */
export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const wide = useWide();
  // At large font sizes the lines wrap, so nothing has to be read by scrolling sideways.
  const wrap = useWindowDimensions().fontScale >= 1.3;
  const [on, setOn] = useState(isDiagnosticsOn);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    await setDiagnostics(next);
    setOn(next);
    setReport(null);
  };

  const prepare = async () => {
    setBusy(true);
    try {
      setReport(await buildReport());
    } catch (error) {
      showAlert(t('Diagnostics'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const share = () => {
    if (!report) return;
    const day = new Date().toISOString().slice(0, 10);
    void shareText(`lelap-diagnostics-${day}.txt`, report).catch((error: unknown) =>
      showAlert(t('Diagnostics'), error instanceof Error ? error.message : String(error)),
    );
  };

  const label = t('Keep a diagnostics log');
  // A device setting, like sync: Settings hides it from a kids profile, and so does this route.
  if (activeProfile()?.kids) return null;

  return (
    <ScrollView
      className="flex-1 bg-night"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 32,
        gap: 16,
        ...(wide ? READABLE : {}),
      }}
    >
      <ScreenHeader
        title={t('Diagnostics')}
        subtitle={t(
          'A log of what went wrong, for a bug report. It stays on this device: Lelap never sends it anywhere. It only leaves when you share the file yourself.',
        )}
      />

      <View className="flex-row items-center gap-4 border-b border-line py-4">
        <View className="flex-1 gap-1">
          <Text className="text-base text-paper">{label}</Text>
          <Text className="text-sm text-muted">
            {t(
              'Errors, player events, failed downloads and scans, add-on and sync trouble, and what the search for speakers and TVs found. The newest {n} events; turning it off deletes them.',
              { n: DIAGNOSTICS_LIMIT },
            )}
          </Text>
        </View>
        <RowLabel.Provider value={label}>
          <Toggle value={on} onValueChange={(v) => void toggle(v)} />
        </RowLabel.Provider>
      </View>

      <View className="gap-2">
        <Text className="text-base text-paper">{t('File for a bug report')}</Text>
        <Text className="text-sm text-muted">
          {t(
            'No titles, file names, addresses, user names, keys or codes. Books, servers and add-ons are numbered instead, such as book#1. You see the whole file before you share it.',
          )}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <TextButton
            text={busy ? t('Preparing…') : report ? t('Prepare again') : t('Prepare the file')}
            disabled={busy}
            onPress={() => void prepare()}
          />
        </View>
      </View>

      {report !== null && (
        <View className="gap-3">
          <Text accessibilityRole="header" className="text-xs uppercase tracking-wider text-muted">
            {t('What the file contains')}
          </Text>
          <ScrollView
            horizontal={!wrap}
            accessibilityLabel={t('What the file contains')}
            className="rounded-lg border border-line"
            contentContainerStyle={{ padding: 12 }}
          >
            <Text selectable className={`font-mono text-soft ${wrap ? 'text-sm' : 'text-xs'}`}>
              {report}
            </Text>
          </ScrollView>
          <View className="flex-row flex-wrap gap-2">
            <TextButton text={Platform.OS === 'web' ? t('Download') : t('Share')} onPress={share} />
            <TextButton text={t('Close')} tone="muted" onPress={() => setReport(null)} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}
