import { hasBigLibrary, removeBigLibrary, seedBigLibrary } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { TextButton } from '../../src/components/TextButton';
import { isDiagnosticsOn } from '../../src/diagnostics';
import { db } from '../../src/db';
import { t } from '../../src/i18n';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { useLibrary } from '../../src/player';
import { activeProfile, profileId } from '../../src/profile';
import { LinkRow, Row, SectionHeader, SettingsPage } from '../../src/settings/rows';

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
        <LinkRow
          label={t('Diagnostics')}
          detail={isDiagnosticsOn() ? t('On') : t('Off')}
          onPress={() => router.push('/diagnostics')}
        />
      )}
      {__DEV__ && (
        <>
          <SectionHeader text={t('Developer')} />
          {LOCAL_FOLDERS && (
            <LinkRow
              label={t('Audio spike')}
              detail={t('The M1 test screen, until its call checks pass.')}
              onPress={() => router.push('/dev/spike')}
            />
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
