import { listProfiles, listRoots, localRoot } from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, Text } from 'react-native';

import { useAddons } from '../../src/addons';
import { db } from '../../src/db';
import { isDiagnosticsOn } from '../../src/diagnostics';
import { formatBytes, formatTimeOfDay } from '../../src/format';
import { languageName } from '../../src/languageName';
import { LANGUAGES, t } from '../../src/i18n';
import { BLUETOOTH } from '../../src/platform/bluetooth';
import * as downloads from '../../src/platform/downloads';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { SELF_UPDATES } from '../../src/platform/updater';
import { useLibrary } from '../../src/player';
import { activeProfile } from '../../src/profile';
import { GroupLine, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';
import { membership } from '../../src/sync';
import { accentLabel, themeLabel } from '../../src/theme';

type Part = string | { text: string; spoken: string };
type Group = { route: Href; title: string; summary: (Part | null | undefined | false)[] };

/**
 * Settings (M133): nine groups, each a line with what it is set to now, opening its own page.
 * A group with nothing to show on this platform or for this profile has no line.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { version } = useLibrary();
  // Re-read when this screen comes back from a group's page, so the lines say what is set now.
  const { settings } = useSettingsState();
  const me = activeProfile();
  const kids = me?.kids === true;
  const addons = useAddons();
  const android = Platform.OS === 'android';
  // `version` is the signal to re-read the database.
  const root = useMemo(() => localRoot(db), [version]);
  const servers = useMemo(() => listRoots(db).filter((r) => r.remote !== null).length, [version]);
  const profiles = useMemo(() => listProfiles(db).length, [version]);
  const storage = useQuery({
    queryKey: ['settings-storage', version],
    queryFn: () => downloads.storage(),
    networkMode: 'always',
  });
  const used = storage.data?.usedBytes;

  const groups: (Group | false)[] = [
    {
      route: '/settings/look',
      title: t('Look and language'),
      summary: [
        themeLabel(settings.theme, settings.customTheme),
        settings.theme !== 'custom' && accentLabel(settings.accent),
        LANGUAGES.find((l) => l.code === settings.language)?.name,
      ],
    },
    {
      route: '/settings/listening',
      title: t('Listening'),
      summary: [
        {
          text: t('Skip {n} s', { n: Math.round(settings.skipIntervalMs / 1000) }),
          spoken: t('Skip {n} seconds', { n: Math.round(settings.skipIntervalMs / 1000) }),
        },
        settings.smartRewind && t('Smart rewind'),
      ],
    },
    // Both of its settings are Android's.
    android && {
      route: '/settings/sleep',
      title: t('Sleep'),
      summary: [
        settings.bedtimeTimer &&
          t('Bedtime {from}–{to}', {
            from: formatTimeOfDay(settings.bedtimeStart),
            to: formatTimeOfDay(settings.bedtimeEnd),
          }),
        settings.bedtimeTimer &&
          (settings.bedtimeChapter
            ? t('End of chapter')
            : t('{n} min', { n: settings.bedtimeMinutes })),
        settings.shakeToExtend && t('Shake for more time'),
      ],
    },
    {
      route: '/settings/library',
      title: t('Library and sources'),
      summary: [
        LOCAL_FOLDERS && root?.name,
        !kids && servers > 0 && (servers === 1 ? t('1 server') : t('{n} servers', { n: servers })),
        addons.length > 0 &&
          (addons.length === 1 ? t('1 add-on') : t('{n} add-ons', { n: addons.length })),
      ],
    },
    // How a book's page orders streams (M153); kids' profiles keep the defaults.
    !kids && {
      route: '/settings/streams',
      title: t('Streams'),
      summary: [
        settings.streamFormats.length > 0 && settings.streamFormats.slice(0, 3).join(', '),
        settings.streamLanguages
          ?.map((code) => languageName(code))
          .slice(0, 2)
          .join(', '),
        !settings.showPreparingStreams && t('Ready ones only'),
      ],
    },
    {
      route: '/settings/downloads',
      title: t('Downloads and storage'),
      summary: [
        LOCAL_FOLDERS && settings.downloadOnWifiOnly && t('Wi-Fi only'),
        LOCAL_FOLDERS && settings.downloadWhileChargingOnly && t('While charging'),
        used !== undefined && used > 0 && formatBytes(used),
      ],
    },
    (!kids || BLUETOOTH) && {
      route: '/settings/people',
      title: t('People and devices'),
      summary: [
        !kids && (profiles === 1 ? t('1 profile') : t('{n} profiles', { n: profiles })),
        !kids && membership() !== null && t('Sync on'),
        BLUETOOTH && settings.carModeOffer && t('Car mode'),
      ],
    },
    (!kids || SELF_UPDATES) && {
      route: '/settings/backup',
      title: t('Backup and updates'),
      summary: [SELF_UPDATES && settings.betaUpdates && t('Beta versions')],
    },
    (!kids || __DEV__) && {
      route: '/settings/help',
      title: t('Help'),
      summary: [isDiagnosticsOn() && t('Diagnostics on')],
    },
  ];

  return (
    <SettingsPage title={t('Settings')}>
      {groups.map(
        (group) =>
          group && (
            <GroupLine
              key={String(group.route)}
              title={group.title}
              parts={group.summary.filter((part): part is Part =>
                typeof part === 'object' ? part !== null : typeof part === 'string' && part !== '',
              )}
              onPress={() => router.push(group.route)}
            />
          ),
      )}
      <Text selectable className="pt-8 text-center text-xs text-muted">
        {t('Lelap {version}', { version: Constants.expoConfig?.version ?? '?' })}
      </Text>
    </SettingsPage>
  );
}
