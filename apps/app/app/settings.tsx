import {
  getSettings,
  listRoots,
  localRoot,
  removeRemoteRoot,
  type Settings,
  setSetting,
} from '@lelap/core';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LANGUAGES, setLanguage, t } from '../src/i18n';
import { exportBackup, importBackup } from '../src/backup';
import { applyBedtime } from '../src/bedtime';
import { allowDevices, followDevices } from '../src/devices';
import { formatTimeOfDay } from '../src/format';
import { BLUETOOTH } from '../src/platform/bluetooth';
import { showAlert } from '../src/dialog';
import { ImportSheet } from '../src/components/ImportSheet';
import { COLORS, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { soundOptions, SoundRow } from '../src/components/SoundSheet';
import { db } from '../src/db';
import { applyRules } from '../src/downloads';
import * as audio from '../src/platform/audio';
import { useLibrary } from '../src/player';
import { activeProfile, profileId } from '../src/profile';
import { LOCAL_FOLDERS } from '../src/platform/library';
import { SELF_UPDATES } from '../src/platform/updater';
import { fetchOtaUpdate, OTA_UPDATES, otaDescription } from '../src/ota';
import { checkForUpdate, installUpdate } from '../src/updates';
import { chooseFolder, scanLibrary } from '../src/scan';
import { Pill } from '../src/components/Pill';
import { RowLabel, TextButton, Toggle } from '../src/components/TextButton';

const SKIP_SECONDS = [10, 15, 30, 45, 60];
const BEDTIME_MINUTES = [15, 30, 45, 60];
const DAY_MINUTES = 24 * 60;
// The bedtime window moves in half hours.
const BEDTIME_STEP = 30;

function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pill
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      className={`rounded-full border px-4 py-2 ${active ? 'border-amber bg-amber' : 'border-line'}`}
    >
      <Text className={active ? 'text-ink' : 'text-soft'}>{label}</Text>
    </Pill>
  );
}

/** A time of day with − and + buttons, half an hour per press. */
function TimeStepper({
  label,
  minutes,
  onChange,
}: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const step = (by: number) => onChange((minutes + by + DAY_MINUTES) % DAY_MINUTES);
  return (
    <View className="flex-row items-center gap-3">
      <Text className="min-w-12 text-soft">{label}</Text>
      <Pressable
        onPress={() => step(-BEDTIME_STEP)}
        accessibilityRole="button"
        accessibilityLabel={t('{time}, 30 minutes earlier', { time: label })}
        className="h-12 w-12 items-center justify-center rounded-full border border-line active:bg-raised"
      >
        <Text className="text-lg text-paper">−</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" className="min-w-16 text-center text-lg text-paper">
        {formatTimeOfDay(minutes)}
      </Text>
      <Pressable
        onPress={() => step(BEDTIME_STEP)}
        accessibilityRole="button"
        accessibilityLabel={t('{time}, 30 minutes later', { time: label })}
        className="h-12 w-12 items-center justify-center rounded-full border border-line active:bg-raised"
      >
        <Text className="text-lg text-paper">+</Text>
      </Pressable>
    </View>
  );
}

function Row({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-4 border-b border-line py-4">
      <View className="flex-1 gap-1">
        <Text className="text-base text-paper">{label}</Text>
        {detail !== undefined && <Text className="text-sm text-muted">{detail}</Text>}
      </View>
      <RowLabel.Provider value={label}>{children}</RowLabel.Provider>
    </View>
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
      <Text accessibilityRole="header" className="pt-6 text-xs uppercase tracking-wider text-muted">
        {t('Updates')}
      </Text>
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

export default function SettingsScreen() {
  const { version, refresh } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState(() => getSettings(db, profileId));
  const me = activeProfile();
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  // `version` is the signal to re-read the database.
  const root = useMemo(() => localRoot(db), [version]);
  const servers = useMemo(() => listRoots(db).filter((r) => r.remote !== null), [version]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSetting(db, profileId, key, value, Date.now());
    const next = getSettings(db, profileId);
    setSettings(next);
    void audio.setSettings(next);
    if (key === 'downloadOnWifiOnly' || key === 'downloadWhileChargingOnly') void applyRules(next);
    if (key.startsWith('bedtime')) void applyBedtime(next);
    if (key === 'headphoneBattery' || key === 'carModeOffer') void followDevices(next);
    if (key === 'language') setLanguage(next.language);
  };

  // Both need “nearby devices”, asked for only when one is turned on.
  const updateDevices = async (key: 'headphoneBattery' | 'carModeOffer', value: boolean) => {
    if (value && !(await allowDevices())) return;
    update(key, value);
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const result = await scanLibrary();
      if ('error' in result) showAlert(t('Cannot read the folder'), t('Choose the folder again.'));
    } finally {
      setScanning(false);
      refresh();
    }
  };

  return (
    <View className="flex-1 bg-night">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 24,
        }}
      >
        <View className="-ms-2 self-start">
          <IconButton
            name="back"
            label={t('Back')}
            color={COLORS.soft}
            onPress={() => router.back()}
          />
        </View>
        <Text accessibilityRole="header" className="pb-4 text-3xl font-semibold text-paper">
          {t('Settings')}
        </Text>

        <View className="gap-3 border-b border-line py-4">
          <View className="-my-3 flex-row items-center">
            <Text className="text-base text-paper">{t('Language')}</Text>
            <IconButton
              name="info"
              size={18}
              label={t('About the language')}
              color={COLORS.muted}
              onPress={() =>
                showAlert(
                  t('Language'),
                  t(
                    'This changes Lelap’s own buttons, menus and messages. Titles, descriptions, covers and audio come from add-ons and your files, and stay as they are.',
                  ),
                )
              }
            />
          </View>
          <Text className="text-sm text-muted">{t('For this profile only.')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <Choice
                key={l.code}
                label={l.name}
                active={settings.language === l.code}
                onPress={() => update('language', l.code)}
              />
            ))}
          </View>
        </View>

        {LOCAL_FOLDERS && (
          <>
            <Text
              accessibilityRole="header"
              className="pt-2 text-xs uppercase tracking-wider text-muted"
            >
              {t('Library')}
            </Text>
            <Row label={t('Audiobooks folder')} detail={root?.name ?? t('Not chosen')}>
              <TextButton
                text={t('Change')}
                onPress={() =>
                  void chooseFolder().then(async (ok) => {
                    if (ok) await rescan();
                  })
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
            <Text
              accessibilityRole="header"
              className="pt-6 text-xs uppercase tracking-wider text-muted"
            >
              {t('Servers')}
            </Text>
            {servers.map((s) => (
              <Row
                key={s.id}
                label={s.name}
                detail={
                  s.needsLogin
                    ? s.remote?.type === 'audiobookshelf'
                      ? t('API key needed: it is not in backups.')
                      : t('Password needed: it is not in backups.')
                    : s.remote?.type === 'audiobookshelf' && s.remote.keyRefused
                      ? t('Audiobookshelf refused the API key. Change it to keep syncing.')
                      : s.remote?.type === 's3'
                        ? t('S3 bucket')
                        : s.remote?.type === 'jellyfin'
                          ? 'Jellyfin'
                          : s.remote?.type === 'audiobookshelf'
                            ? 'Audiobookshelf'
                            : 'WebDAV'
                }
              >
                {(s.needsLogin || (s.remote?.type === 'audiobookshelf' && s.remote.keyRefused)) && (
                  <TextButton
                    text={s.remote?.type === 'audiobookshelf' ? t('Change key') : t('Log in')}
                    onPress={() => router.push(`/server?root=${s.id}`)}
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
              detail={t('WebDAV, an S3-compatible bucket, Jellyfin or Audiobookshelf.')}
            >
              <TextButton text={t('Add')} onPress={() => router.push('/server')} />
            </Row>
          </>
        )}
        <Text
          accessibilityRole="header"
          className="pt-6 text-xs uppercase tracking-wider text-muted"
        >
          {t('Downloads')}
        </Text>
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
        <Row
          label={t('Downloads and storage')}
          detail={t('What is on the phone and how much space it takes.')}
        >
          <TextButton text={t('Open')} onPress={() => router.push('/downloads')} />
        </Row>

        {!me?.kids && (
          <>
            <Text
              accessibilityRole="header"
              className="pt-6 text-xs uppercase tracking-wider text-muted"
            >
              {t('People')}
            </Text>
            <Row
              label={t('Profiles')}
              detail={t('Everyone who listens here, each with their own places.')}
            >
              <TextButton text={t('Manage')} onPress={() => router.push('/profiles')} />
            </Row>
          </>
        )}

        {!me?.kids && (
          <>
            <Text
              accessibilityRole="header"
              className="pt-6 text-xs uppercase tracking-wider text-muted"
            >
              {t('Devices')}
            </Text>
            <Row
              label={t('Sync')}
              detail={t('Keep your places and podcasts in step on your other devices.')}
            >
              <TextButton text={t('Open')} onPress={() => router.push('/sync')} />
            </Row>

            {!me?.kids && <></>}
            <Text
              accessibilityRole="header"
              className="pt-6 text-xs uppercase tracking-wider text-muted"
            >
              {t('Backup')}
            </Text>
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
        <Text
          accessibilityRole="header"
          className="pt-6 text-xs uppercase tracking-wider text-muted"
        >
          {t('Catalogs')}
        </Text>
        <Row label={t('Add-ons')} detail={t('Where Home, Discover and Search look for books.')}>
          <TextButton text={t('Manage')} onPress={() => router.push('/addons')} />
        </Row>

        <Text
          accessibilityRole="header"
          className="pt-6 text-xs uppercase tracking-wider text-muted"
        >
          {t('Playback')}
        </Text>
        <Row
          label={t('Duck on calls')}
          detail={t('Lower the volume during calls instead of pausing.')}
        >
          <Toggle
            value={settings.duckOnInterruption}
            onValueChange={(v) => update('duckOnInterruption', v)}
          />
        </Row>
        <Row
          label={t('Smart rewind')}
          detail={t('Go back a few seconds when you resume after a pause.')}
        >
          <Toggle value={settings.smartRewind} onValueChange={(v) => update('smartRewind', v)} />
        </Row>
        {soundOptions().map((o) => (
          <SoundRow
            key={o.key}
            label={o.label}
            detail={o.detail}
            value={settings[o.key]}
            onChange={(v) => update(o.key, v)}
          />
        ))}
        <View className="gap-3 border-b border-line py-4">
          <Text className="text-base text-paper">{t('Skip interval')}</Text>
          <Text className="text-sm text-muted">
            {t('For the skip buttons, the lock screen and headphones.')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {SKIP_SECONDS.map((s) => {
              const active = settings.skipIntervalMs === s * 1000;
              return (
                <Pill
                  key={s}
                  onPress={() => update('skipIntervalMs', s * 1000)}
                  accessibilityLabel={t('{n} seconds', { n: s })}
                  accessibilityState={{ selected: active }}
                  aria-selected={active}
                  className={`rounded-full border px-4 py-2 ${active ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={active ? 'text-ink' : 'text-soft'}>{s} s</Text>
                </Pill>
              );
            })}
          </View>
        </View>

        {Platform.OS === 'android' && (
          <View className="gap-3 border-b border-line py-4">
            <View className="flex-row items-center gap-4">
              <View className="flex-1 gap-1">
                <Text className="text-base text-paper">{t('Start a sleep timer at bedtime')}</Text>
                <Text className="text-sm text-muted">
                  {t('When you press Play in this window, once a night.')}
                </Text>
              </View>
              <Toggle
                accessibilityLabel={t('Start a sleep timer at bedtime')}
                value={settings.bedtimeTimer}
                onValueChange={(v) => update('bedtimeTimer', v)}
              />
            </View>
            {settings.bedtimeTimer && (
              <>
                <TimeStepper
                  label={t('From')}
                  minutes={settings.bedtimeStart}
                  onChange={(m) => update('bedtimeStart', m)}
                />
                <TimeStepper
                  label={t('To')}
                  minutes={settings.bedtimeEnd}
                  onChange={(m) => update('bedtimeEnd', m)}
                />
                <View className="flex-row flex-wrap gap-2">
                  {BEDTIME_MINUTES.map((m) => (
                    <Choice
                      key={m}
                      label={t('{n} min', { n: m })}
                      active={!settings.bedtimeChapter && settings.bedtimeMinutes === m}
                      onPress={() => {
                        update('bedtimeChapter', false);
                        update('bedtimeMinutes', m);
                      }}
                    />
                  ))}
                  <Choice
                    label={t('End of chapter')}
                    active={settings.bedtimeChapter}
                    onPress={() => update('bedtimeChapter', true)}
                  />
                </View>
              </>
            )}
          </View>
        )}

        {BLUETOOTH && (
          <>
            <Text
              accessibilityRole="header"
              className="pt-6 text-xs uppercase tracking-wider text-muted"
            >
              {t('Headphones and car')}
            </Text>
            <Row
              label={t('Warn about low headphone battery')}
              detail={t(
                'When your Bluetooth headphones or speaker likely won’t last the sleep timer or the chapter. Needs “nearby devices”; devices that don’t report a level show nothing.',
              )}
            >
              <Toggle
                value={settings.headphoneBattery}
                onValueChange={(v) => void updateDevices('headphoneBattery', v)}
              />
            </Row>
            <Row
              label={t('Offer car mode in the car')}
              detail={t(
                'Big buttons when the phone connects to a car’s Bluetooth. Needs “nearby devices”. Car mode is always in the player.',
              )}
            >
              <Toggle
                value={settings.carModeOffer}
                onValueChange={(v) => void updateDevices('carModeOffer', v)}
              />
            </Row>
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

        {__DEV__ && LOCAL_FOLDERS && (
          <>
            <Text
              accessibilityRole="header"
              className="pt-6 text-xs uppercase tracking-wider text-muted"
            >
              {t('Developer')}
            </Text>
            <Row
              label={t('Audio spike')}
              detail={t('The M1 test screen, until its call checks pass.')}
            >
              <TextButton text={t('Open')} onPress={() => router.push('/dev/spike')} />
            </Row>
          </>
        )}
        <Text selectable className="pt-8 text-center text-xs text-muted">
          {t('Lelap {version}', { version: Constants.expoConfig?.version ?? '?' })}
        </Text>
      </ScrollView>
      <MiniPlayer />
    </View>
  );
}
