import { useState } from 'react';

import { exportBackup, importBackup } from '../../src/backup';
import { ImportSheet } from '../../src/components/ImportSheet';
import { TextButton, Toggle } from '../../src/components/TextButton';
import { showAlert } from '../../src/dialog';
import { t } from '../../src/i18n';
import { fetchOtaUpdate, OTA_UPDATES, otaDescription } from '../../src/ota';
import { SELF_UPDATES } from '../../src/platform/updater';
import { useLibrary } from '../../src/player';
import { activeProfile } from '../../src/profile';
import { Row, SectionHeader, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';
import { checkForUpdate, installUpdate } from '../../src/updates';

/** Settings → Backup and updates: the library as a file, other apps' exports, new versions. */
export default function BackupSettings() {
  const { refresh } = useLibrary();
  const { settings, update } = useSettingsState();
  const me = activeProfile();
  const [importing, setImporting] = useState(false);
  return (
    <SettingsPage title={t('Backup and updates')}>
      {!me?.kids && (
        <>
          <Row
            label={t('Export library')}
            detail={t(
              'Places, bookmarks, lists, tags, podcasts and add-on addresses in one file. Add-on addresses can hold your keys for them; keep the file private.',
            )}
          >
            <TextButton
              text={t('Export')}
              onPress={() =>
                void exportBackup().catch((error: unknown) =>
                  showAlert(t('Export'), error instanceof Error ? error.message : String(error)),
                )
              }
            />
          </Row>
          <Row
            label={t('Import library')}
            detail={t(
              'Merges an export into this device. Where both have a change, the newer one stays. Local books need their folder chosen first.',
            )}
          >
            <TextButton
              text={t('Import')}
              onPress={() =>
                void importBackup(true, refresh).catch((error: unknown) =>
                  showAlert(t('Import'), error instanceof Error ? error.message : String(error)),
                )
              }
            />
          </Row>
          <Row
            label={t('Import from another app')}
            detail={t(
              'Goodreads shelves, AntennaPod subscriptions and Smart AudioBook Player places.',
            )}
          >
            <TextButton text={t('Choose')} onPress={() => setImporting(true)} />
          </Row>
          <ImportSheet
            visible={importing}
            onClose={() => setImporting(false)}
            onImported={refresh}
          />
        </>
      )}
      {SELF_UPDATES && (
        <UpdateRows
          betaUpdates={settings.betaUpdates}
          onBeta={(v) => update('betaUpdates', v)}
          otaUpdates={settings.otaUpdates}
          onOta={(v) => update('otaUpdates', v)}
        />
      )}
    </SettingsPage>
  );
}

/** Android: the beta channel, automatic bundle updates and a manual check. */
function UpdateRows({
  betaUpdates,
  onBeta,
  otaUpdates,
  onOta,
}: {
  betaUpdates: boolean;
  onBeta: (v: boolean) => void;
  otaUpdates: boolean;
  onOta: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const release = await checkForUpdate();
      if (!release) {
        // No new APK: a smaller update may still wait for this build.
        const ota = await fetchOtaUpdate();
        setStatus(
          ota === 'downloaded'
            ? t('An update is ready. It starts the next time you open Lelap.')
            : ota === 'error'
              ? t('The update server could not be reached.')
              : t('Lelap is up to date.'),
        );
        return;
      }
      setStatus(t('Installing {version}…', { version: release.version }));
      await installUpdate(release);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionHeader text={t('Updates')} />
      <Row label={t('Beta versions')} detail={t('Try new versions before everyone else.')}>
        <Toggle value={betaUpdates} onValueChange={onBeta} />
      </Row>
      {OTA_UPDATES && (
        <Row
          label={t('Download updates automatically')}
          detail={`${t('Small updates load in the background and start the next time you open Lelap.')} ${otaDescription() ?? ''}`.trim()}
        >
          <Toggle value={otaUpdates} onValueChange={onOta} />
        </Row>
      )}
      <Row label={t('Check for updates')} {...(status ? { detail: status } : {})}>
        <TextButton
          text={busy ? t('Checking…') : t('Check')}
          disabled={busy}
          onPress={() => void check()}
        />
      </Row>
    </>
  );
}
