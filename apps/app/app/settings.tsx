import {
  getSettings,
  listRoots,
  localRoot,
  removeRemoteRoot,
  type Settings,
  setSetting,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { exportBackup, importBackup } from '../src/backup';
import { applyBedtime } from '../src/bedtime';
import { allowDevices, followDevices } from '../src/devices';
import { formatTimeOfDay } from '../src/format';
import { BLUETOOTH } from '../src/platform/bluetooth';
import { showAlert } from '../src/dialog';
import { ImportSheet } from '../src/components/ImportSheet';
import { COLORS, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { SOUND_OPTIONS, SoundRow } from '../src/components/SoundSheet';
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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`rounded-full border px-4 py-2 ${active ? 'border-amber bg-amber' : 'border-line'}`}
    >
      <Text className={active ? 'text-ink' : 'text-soft'}>{label}</Text>
    </Pressable>
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
      <Text className="w-12 text-soft">{label}</Text>
      <Pressable
        onPress={() => step(-BEDTIME_STEP)}
        accessibilityRole="button"
        accessibilityLabel={`${label} 30 minutes earlier`}
        className="h-11 w-11 items-center justify-center rounded-full border border-line active:bg-raised"
      >
        <Text className="text-lg text-paper">−</Text>
      </Pressable>
      <Text className="w-16 text-center text-lg text-paper">{formatTimeOfDay(minutes)}</Text>
      <Pressable
        onPress={() => step(BEDTIME_STEP)}
        accessibilityRole="button"
        accessibilityLabel={`${label} 30 minutes later`}
        className="h-11 w-11 items-center justify-center rounded-full border border-line active:bg-raised"
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
      {children}
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
            ? 'An update is ready. It starts the next time you open Lelap.'
            : ota === 'error'
              ? 'The update server could not be reached.'
              : 'Lelap is up to date.',
        );
        return;
      }
      setStatus(`Installing ${release.version}…`);
      await installUpdate(release);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Updates</Text>
      <Row label="Beta versions" detail="Try new versions before everyone else.">
        <Switch value={betaUpdates} onValueChange={onBeta} />
      </Row>
      {OTA_UPDATES && (
        <Row
          label="Download updates automatically"
          detail={`Small updates load in the background and start the next time you open Lelap. ${otaDescription() ?? ''}`.trim()}
        >
          <Switch value={otaUpdates} onValueChange={onOta} />
        </Row>
      )}
      <Row label="Check for updates" {...(status ? { detail: status } : {})}>
        <Pressable disabled={busy} onPress={() => void check()}>
          <Text className={busy ? 'text-muted' : 'text-amber'}>{busy ? 'Checking…' : 'Check'}</Text>
        </Pressable>
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
      if ('error' in result) showAlert('Cannot read the folder', 'Choose the folder again.');
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
        <View className="-ml-2 self-start">
          <IconButton name="back" label="Back" color={COLORS.soft} onPress={() => router.back()} />
        </View>
        <Text className="pb-4 text-3xl font-semibold text-paper">Settings</Text>

        {LOCAL_FOLDERS && (
          <>
            <Text className="pt-2 text-xs uppercase tracking-wider text-muted">Library</Text>
            <Row label="Audiobooks folder" detail={root?.name ?? 'Not chosen'}>
              <Pressable
                onPress={() =>
                  void chooseFolder().then(async (ok) => {
                    if (ok) await rescan();
                  })
                }
              >
                <Text className="text-amber">Change</Text>
              </Pressable>
            </Row>
            <Row label="Look for new and changed files">
              <Pressable disabled={scanning || !root} onPress={() => void rescan()}>
                <Text className={scanning ? 'text-muted' : 'text-amber'}>
                  {scanning ? 'Scanning…' : 'Rescan'}
                </Text>
              </Pressable>
            </Row>
          </>
        )}

        {!me?.kids && (
          <>
            <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Servers</Text>
            {servers.map((s) => (
              <Row
                key={s.id}
                label={s.name}
                detail={
                  s.needsLogin
                    ? 'Password needed: it is not in backups.'
                    : s.remote?.type === 's3'
                      ? 'S3 bucket'
                      : s.remote?.type === 'jellyfin'
                        ? 'Jellyfin'
                        : 'WebDAV'
                }
              >
                {s.needsLogin && (
                  <Pressable onPress={() => router.push(`/server?root=${s.id}`)}>
                    <Text className="text-amber">Log in</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() =>
                    showAlert(
                      `Remove ${s.name}?`,
                      'Its books and your places in them are removed from Lelap. Nothing on the server changes.',
                      [
                        { text: 'Keep', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => {
                            removeRemoteRoot(db, s.id);
                            refresh();
                          },
                        },
                      ],
                    )
                  }
                >
                  <Text className="text-danger">Remove</Text>
                </Pressable>
              </Row>
            ))}
            <Row
              label="Add a server"
              detail="WebDAV (Nextcloud, ownCloud, a NAS) or an S3-compatible bucket."
            >
              <Pressable onPress={() => router.push('/server')}>
                <Text className="text-amber">Add</Text>
              </Pressable>
            </Row>
          </>
        )}
        <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Downloads</Text>
        {LOCAL_FOLDERS && (
          <>
            <Row
              label="Download only on Wi-Fi"
              detail="Downloads wait for Wi-Fi instead of using mobile data."
            >
              <Switch
                value={settings.downloadOnWifiOnly}
                onValueChange={(v) => update('downloadOnWifiOnly', v)}
              />
            </Row>
            <Row label="Download only while charging" detail="Good for downloading overnight.">
              <Switch
                value={settings.downloadWhileChargingOnly}
                onValueChange={(v) => update('downloadWhileChargingOnly', v)}
              />
            </Row>
          </>
        )}
        <Row
          label="Downloads and storage"
          detail="What is on the phone and how much space it takes."
        >
          <Pressable onPress={() => router.push('/downloads')}>
            <Text className="text-amber">Open</Text>
          </Pressable>
        </Row>

        {!me?.kids && (
          <>
            <Text className="pt-6 text-xs uppercase tracking-wider text-muted">People</Text>
            <Row label="Profiles" detail="Everyone who listens here, each with their own places.">
              <Pressable onPress={() => router.push('/profiles')}>
                <Text className="text-amber">Manage</Text>
              </Pressable>
            </Row>
          </>
        )}

        {!me?.kids && (
          <>
            <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Devices</Text>
            <Row label="Sync" detail="Keep your places and podcasts in step on your other devices.">
              <Pressable onPress={() => router.push('/sync')}>
                <Text className="text-amber">Open</Text>
              </Pressable>
            </Row>

            {!me?.kids && <></>}
            <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Backup</Text>
            <Row
              label="Export library"
              detail="Places, bookmarks, lists, tags, podcasts and add-on addresses in one file. Add-on addresses can hold your keys for them; keep the file private."
            >
              <Pressable
                onPress={() =>
                  void exportBackup().catch((error: unknown) =>
                    showAlert('Export', error instanceof Error ? error.message : String(error)),
                  )
                }
              >
                <Text className="text-amber">Export</Text>
              </Pressable>
            </Row>
            <Row
              label="Import library"
              detail="Merges an export into this device. Where both have a change, the newer one stays. Local books need their folder chosen first."
            >
              <Pressable
                onPress={() =>
                  void importBackup(true, refresh).catch((error: unknown) =>
                    showAlert('Import', error instanceof Error ? error.message : String(error)),
                  )
                }
              >
                <Text className="text-amber">Import</Text>
              </Pressable>
            </Row>
            <Row
              label="Import from another app"
              detail="Goodreads shelves, AntennaPod subscriptions and Smart AudioBook Player places."
            >
              <Pressable onPress={() => setImporting(true)}>
                <Text className="text-amber">Choose</Text>
              </Pressable>
            </Row>
            <ImportSheet
              visible={importing}
              onClose={() => setImporting(false)}
              onImported={refresh}
            />
          </>
        )}
        <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Catalogs</Text>
        <Row label="Add-ons" detail="Where Home, Discover and Search look for books.">
          <Pressable onPress={() => router.push('/addons')}>
            <Text className="text-amber">Manage</Text>
          </Pressable>
        </Row>

        <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Playback</Text>
        <Row label="Duck on calls" detail="Lower the volume during calls instead of pausing.">
          <Switch
            value={settings.duckOnInterruption}
            onValueChange={(v) => update('duckOnInterruption', v)}
          />
        </Row>
        <Row label="Smart rewind" detail="Go back a few seconds when you resume after a pause.">
          <Switch value={settings.smartRewind} onValueChange={(v) => update('smartRewind', v)} />
        </Row>
        {SOUND_OPTIONS.map((o) => (
          <SoundRow
            key={o.key}
            label={o.label}
            detail={o.detail}
            value={settings[o.key]}
            onChange={(v) => update(o.key, v)}
          />
        ))}
        <View className="gap-3 border-b border-line py-4">
          <Text className="text-base text-paper">Skip interval</Text>
          <Text className="text-sm text-muted">
            For the skip buttons, the lock screen and headphones.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {SKIP_SECONDS.map((s) => {
              const active = settings.skipIntervalMs === s * 1000;
              return (
                <Pressable
                  key={s}
                  onPress={() => update('skipIntervalMs', s * 1000)}
                  className={`rounded-full border px-4 py-2 ${active ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={active ? 'text-ink' : 'text-soft'}>{s} s</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {Platform.OS === 'android' && (
          <View className="gap-3 border-b border-line py-4">
            <View className="flex-row items-center gap-4">
              <View className="flex-1 gap-1">
                <Text className="text-base text-paper">Start a sleep timer at bedtime</Text>
                <Text className="text-sm text-muted">
                  When you press Play in this window, once a night.
                </Text>
              </View>
              <Switch
                value={settings.bedtimeTimer}
                onValueChange={(v) => update('bedtimeTimer', v)}
              />
            </View>
            {settings.bedtimeTimer && (
              <>
                <TimeStepper
                  label="From"
                  minutes={settings.bedtimeStart}
                  onChange={(m) => update('bedtimeStart', m)}
                />
                <TimeStepper
                  label="To"
                  minutes={settings.bedtimeEnd}
                  onChange={(m) => update('bedtimeEnd', m)}
                />
                <View className="flex-row flex-wrap gap-2">
                  {BEDTIME_MINUTES.map((m) => (
                    <Choice
                      key={m}
                      label={`${m} min`}
                      active={!settings.bedtimeChapter && settings.bedtimeMinutes === m}
                      onPress={() => {
                        update('bedtimeChapter', false);
                        update('bedtimeMinutes', m);
                      }}
                    />
                  ))}
                  <Choice
                    label="End of chapter"
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
            <Text className="pt-6 text-xs uppercase tracking-wider text-muted">
              Headphones and car
            </Text>
            <Row
              label="Warn about low headphone battery"
              detail="When your Bluetooth headphones or speaker likely won’t last the sleep timer or the chapter. Needs “nearby devices”; devices that don’t report a level show nothing."
            >
              <Switch
                value={settings.headphoneBattery}
                onValueChange={(v) => void updateDevices('headphoneBattery', v)}
              />
            </Row>
            <Row
              label="Offer car mode in the car"
              detail="Big buttons when the phone connects to a car’s Bluetooth. Needs “nearby devices”. Car mode is always in the player."
            >
              <Switch
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
            <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Developer</Text>
            <Row label="Audio spike" detail="The M1 test screen, until its call checks pass.">
              <Pressable onPress={() => router.push('/dev/spike')}>
                <Text className="text-amber">Open</Text>
              </Pressable>
            </Row>
          </>
        )}
      </ScrollView>
      <MiniPlayer />
    </View>
  );
}
