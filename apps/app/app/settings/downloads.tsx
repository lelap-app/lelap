import { listDownloads } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { db } from '../../src/db';
import { showAlert } from '../../src/dialog';
import { formatBytes } from '../../src/format';
import { TextButton, Toggle } from '../../src/components/TextButton';
import {
  chooseDownloadFolder,
  describeLocation,
  resetDownloadFolder,
  useDownloadLocation,
} from '../../src/downloads';
import { t } from '../../src/i18n';
import { CHOOSE_LOCATION } from '../../src/platform/downloads';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { useLibrary } from '../../src/player';
import { LinkRow, Row, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';

/** Settings → Downloads and storage: Wi-Fi and charging rules, the folder, what is kept. */
export default function DownloadSettings() {
  const router = useRouter();
  const { settings, update } = useSettingsState();
  const { version } = useLibrary();
  // `version` is the signal to re-read the database.
  const kept = useMemo(() => {
    const done = listDownloads(db).filter((d) => d.state === 'done');
    return { count: done.length, bytes: done.reduce((sum, d) => sum + d.bytesTotal, 0) };
  }, [version]);
  return (
    <SettingsPage title={t('Downloads and storage')}>
      {LOCAL_FOLDERS && (
        <>
          <Row
            label={t('Download only on Wi-Fi')}
            detail={t('Downloads wait for Wi-Fi instead of using mobile data.')}
          >
            <Toggle
              value={settings.downloadOnWifiOnly}
              onValueChange={(v) => update('downloadOnWifiOnly', v)}
            />
          </Row>
          <Row
            label={t('Download only while charging')}
            detail={t('Good for downloading overnight.')}
          >
            <Toggle
              value={settings.downloadWhileChargingOnly}
              onValueChange={(v) => update('downloadWhileChargingOnly', v)}
            />
          </Row>
        </>
      )}
      <DownloadFolderRow />
      <LinkRow
        label={t('Downloads')}
        detail={
          kept.count === 0
            ? t('None yet')
            : `${kept.count === 1 ? t('1 download') : t('{n} downloads', { n: kept.count })} · ${formatBytes(kept.bytes)}`
        }
        onPress={() => router.push('/downloads')}
      />
    </SettingsPage>
  );
}

/** Where downloads go: inside Lelap, or a folder such as one on the SD card (Android only). */
function DownloadFolderRow() {
  const location = useDownloadLocation();
  const act = (task: () => Promise<void>) =>
    void task().catch((error: unknown) =>
      showAlert(t('Download folder'), error instanceof Error ? error.message : String(error)),
    );
  if (!CHOOSE_LOCATION) {
    return (
      <Row
        label={t('Download folder')}
        detail={t(
          'The browser keeps downloads in its own storage. Choosing a folder, such as one on an SD card, is in the Android app.',
        )}
      />
    );
  }
  return (
    <>
      <Row label={t('Download folder')} detail={location ? describeLocation(location) : ''}>
        <TextButton text={t('Choose')} onPress={() => act(chooseDownloadFolder)} />
      </Row>
      {location?.uri != null && (
        <Row
          label={t('Back inside Lelap')}
          detail={t('Downloads move back to the app’s own storage.')}
        >
          <TextButton text={t('Move back')} onPress={() => act(resetDownloadFolder)} />
        </Row>
      )}
    </>
  );
}
