import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { showAlert } from '../../src/dialog';
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
import { Row, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';

/** Settings → Downloads and storage: Wi-Fi and charging rules, the folder, what is kept. */
export default function DownloadSettings() {
  const router = useRouter();
  const { settings, update } = useSettingsState();
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
      <Row
        label={t('Downloads and storage')}
        detail={
          Platform.OS === 'web'
            ? t('What is kept in this browser and how much space it takes.')
            : t('What is on the phone and how much space it takes.')
        }
      >
        <TextButton text={t('Open')} onPress={() => router.push('/downloads')} />
      </Row>
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
