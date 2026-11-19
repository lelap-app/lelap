import { hasBigLibrary, removeBigLibrary, seedBigLibrary } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { TextButton } from '../../src/components/TextButton';
import { db } from '../../src/db';
import { t } from '../../src/i18n';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { useLibrary } from '../../src/player';
import { activeProfile, profileId } from '../../src/profile';
import { Row, SectionHeader, SettingsPage } from '../../src/settings/rows';

/** Settings → Help: diagnostics, and the developer's rows in a development build. */
export default function HelpSettings() {
  const router = useRouter();
  const { version, refresh } = useLibrary();
  const me = activeProfile();
  // `version` is the signal to re-read the database.
  const testLibrary = useMemo(() => __DEV__ && hasBigLibrary(db), [version]);
  const toggleTestLibrary = () => {
    if (testLibrary) removeBigLibrary(db);
    else seedBigLibrary(db, profileId, { now: Date.now() });
    refresh();
  };
  return (
    <SettingsPage title={t('Help')}>
      {!me?.kids && (
        <Row
          label={t('Diagnostics')}
          detail={t(
            'A log of what went wrong, kept on this device, for a bug report. Off until you turn it on.',
          )}
        >
          <TextButton text={t('Open')} onPress={() => router.push('/diagnostics')} />
        </Row>
      )}
      {__DEV__ && (
        <>
          <SectionHeader text={t('Developer')} />
          {LOCAL_FOLDERS && (
            <Row
              label={t('Audio spike')}
              detail={t('The M1 test screen, until its call checks pass.')}
            >
              <TextButton text={t('Open')} onPress={() => router.push('/dev/spike')} />
            </Row>
          )}
          <Row
            label={t('Test library')}
            detail={t(
              '10,000 made-up books and 500 podcasts, for timing a big library. They don’t play.',
            )}
          >
            <TextButton text={testLibrary ? t('Remove') : t('Add')} onPress={toggleTestLibrary} />
          </Row>
        </>
      )}
    </SettingsPage>
  );
}
