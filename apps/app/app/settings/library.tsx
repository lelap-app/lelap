import {
  listRoots,
  localRoot,
  removeRemoteRoot,
  sameAddonCode,
  takesSecondAddress,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { serversChanged } from '../../src/addresses';
import { codeFingerprint } from '../../src/addonSources';
import { TextButton, Toggle } from '../../src/components/TextButton';
import { db } from '../../src/db';
import { showAlert } from '../../src/dialog';
import { t } from '../../src/i18n';
import { askLocalNetwork, useNeedsLocalNetwork } from '../../src/localNetwork';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { useLibrary } from '../../src/player';
import { activeProfile } from '../../src/profile';
import { closeSandbox } from '../../src/sandbox';
import { chooseFolder, scanLibrary } from '../../src/scan';
import { Row, SectionHeader, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';

/** Settings → Library and sources: the audiobooks folder, servers, add-ons and Home's suggestions. */
export default function LibrarySettings() {
  const router = useRouter();
  const { version, refresh } = useLibrary();
  const { settings, update } = useSettingsState();
  const me = activeProfile();
  const [scanning, setScanning] = useState(false);
  // `version` is the signal to re-read the database.
  const root = useMemo(() => localRoot(db), [version]);
  const servers = useMemo(() => listRoots(db).filter((r) => r.remote !== null), [version]);
  const needsLocalNetwork = useNeedsLocalNetwork();

  const rescan = async () => {
    setScanning(true);
    try {
      const result = await scanLibrary();
      if ('error' in result) showAlert(t('Cannot read the folder'), t('Choose the folder again.'));
    } catch (error) {
      showAlert(t('Scan failed'), error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
      refresh();
    }
  };

  return (
    <SettingsPage title={t('Library and sources')}>
      {LOCAL_FOLDERS && (
        <>
          <SectionHeader text={t('Library')} />
          <Row label={t('Audiobooks folder')} detail={root?.name ?? t('Not chosen')}>
            <TextButton
              text={t('Change')}
              onPress={() =>
                void chooseFolder().then(
                  async (ok) => {
                    if (ok) await rescan();
                  },
                  (error: unknown) =>
                    showAlert(
                      t('Cannot open the folder'),
                      error instanceof Error ? error.message : String(error),
                    ),
                )
              }
            />
          </Row>
          <Row label={t('Look for new and changed files')}>
            <TextButton
              text={scanning ? t('Scanning…') : t('Rescan')}
              disabled={scanning || !root}
              onPress={() => void rescan()}
            />
          </Row>
        </>
      )}

      {!me?.kids && (
        <>
          <SectionHeader text={t('Servers')} />
          {servers.map((s) => (
            <Row
              key={s.id}
              label={s.name}
              detail={
                s.needsLogin
                  ? s.remote?.type === 'audiobookshelf'
                    ? t('API key needed: it is not in backups.')
                    : t('Password needed: it is not in backups.')
                  : needsLocalNetwork.has(s.id)
                    ? t(
                        'Needs local network access to reach this server at home. Android calls it “nearby devices”.',
                      )
                    : s.remote?.type === 'audiobookshelf' && s.remote.keyRefused
                      ? t('Audiobookshelf refused the API key. Change it to keep syncing.')
                      : s.remote?.type === 'sftp' && s.remote.refused === 'host-key'
                        ? t(
                            'The server’s host key changed, so Lelap did not connect. If you changed it yourself, remove the server in Settings and add it again.',
                          )
                        : (s.remote?.type === 'smb' || s.remote?.type === 'sftp') &&
                            s.remote.refused === 'login'
                          ? t('The server refused the login. Log in again in Settings.')
                          : s.remote?.type === 'addon' &&
                              !sameAddonCode(s.remote, codeFingerprint(s.remote.addonUrl))
                            ? t('The add-on changed. Log in again to use it.')
                            : s.remote?.type === 's3'
                              ? t('S3 bucket')
                              : s.remote?.type === 'smb'
                                ? t('SMB share')
                                : s.remote?.type === 'sftp'
                                  ? t('SFTP folder')
                                  : s.remote?.type === 'jellyfin'
                                    ? 'Jellyfin'
                                    : s.remote?.type === 'audiobookshelf'
                                      ? 'Audiobookshelf'
                                      : s.remote?.type === 'addon'
                                        ? t('Add-on on this device')
                                        : 'WebDAV'
              }
            >
              {(s.needsLogin ||
                (s.remote?.type === 'audiobookshelf' && s.remote.keyRefused) ||
                ((s.remote?.type === 'smb' || s.remote?.type === 'sftp') &&
                  s.remote.refused === 'login') ||
                (s.remote?.type === 'addon' &&
                  !sameAddonCode(s.remote, codeFingerprint(s.remote.addonUrl)))) && (
                <TextButton
                  text={s.remote?.type === 'audiobookshelf' ? t('Change key') : t('Log in')}
                  onPress={() => router.push(`/server?root=${s.id}`)}
                />
              )}
              {!s.needsLogin && needsLocalNetwork.has(s.id) && (
                <TextButton
                  text={t('Allow')}
                  disabled={scanning}
                  onPress={() =>
                    void askLocalNetwork(true).then(async (ok) => {
                      if (ok) await rescan();
                    })
                  }
                />
              )}
              {!s.needsLogin && takesSecondAddress(s.remote) && (
                <TextButton
                  text={t('Addresses')}
                  onPress={() => router.push(`/server?root=${s.id}&addresses=1`)}
                />
              )}
              <TextButton
                text={t('Remove')}
                onPress={() =>
                  showAlert(
                    t('Remove {name}?', { name: s.name }),
                    t(
                      'Its books and your places in them are removed from Lelap. Nothing on the server changes.',
                    ),
                    [
                      { text: t('Keep'), style: 'cancel' },
                      {
                        text: t('Remove'),
                        style: 'destructive',
                        onPress: () => {
                          removeRemoteRoot(db, s.id);
                          serversChanged();
                          if (s.remote?.type === 'addon') {
                            closeSandbox(`${s.remote.addonUrl}#${s.id}`);
                          }
                          refresh();
                        },
                      },
                    ],
                  )
                }
                tone="danger"
              />
            </Row>
          ))}
          <Row
            label={t('Add a server')}
            detail={t(
              'WebDAV, an S3-compatible bucket, Jellyfin, Audiobookshelf, an HTTP folder or a Subsonic server such as Navidrome.',
            )}
          >
            <TextButton text={t('Add')} onPress={() => router.push('/server')} />
          </Row>
        </>
      )}

      <SectionHeader text={t('Catalogs')} />
      <Row label={t('Add-ons')} detail={t('Where Home, Discover and Search look for books.')}>
        <TextButton text={t('Manage')} onPress={() => router.push('/addons')} />
      </Row>
      <Row
        label={t('Suggestions on Home')}
        detail={
          Platform.OS === 'web'
            ? t('“Because you finished …” rows, worked out on this device from what you finish.')
            : t('“Because you finished …” rows, worked out on this phone from what you finish.')
        }
      >
        <Toggle
          value={settings.homeSuggestions}
          onValueChange={(v) => update('homeSuggestions', v)}
        />
      </Row>
    </SettingsPage>
  );
}
