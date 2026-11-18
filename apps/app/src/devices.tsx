import {
  type BatterySample,
  chapterAt,
  getBook,
  getSettings,
  headphoneWarning,
  type Settings,
  toBookPosition,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { t } from './i18n';
import { showAlert } from './dialog';
import { Icon } from './components/Icon';
import { db } from './db';
import * as bluetooth from './platform/bluetooth';
import { useLibrary, usePlayerState } from './player';
import { profileId } from './profile';

// Connected Bluetooth audio devices (M33), followed only while the headphone battery warning or
// the car mode offer is on. Levels are kept per device while it stays connected, to measure drain.

type Snapshot = { devices: bluetooth.AudioDevice[]; samples: Map<string, BatterySample[]> };

let snapshot: Snapshot = { devices: [], samples: new Map() };
const listeners = new Set<() => void>();
const carListeners = new Set<(car: bluetooth.AudioDevice) => void>();
let subscription: { remove: () => void } | null = null;

function update(found: bluetooth.AudioDevice[]) {
  // Android names some devices nothing; native code leaves the name empty for the app to fill.
  const devices = found.map((d) => (d.name ? d : { ...d, name: t('Bluetooth device') }));
  const now = Date.now();
  const samples = new Map<string, BatterySample[]>();
  for (const d of devices) {
    const before = snapshot.samples.get(d.id) ?? [];
    const last = before.at(-1);
    const next =
      d.battery !== null && last?.level !== d.battery
        ? [...before, { at: now, level: d.battery }]
        : before;
    samples.set(d.id, next.slice(-20));
  }
  const known = new Set(snapshot.devices.map((d) => d.id));
  const arrived = devices.filter((d) => d.car && !known.has(d.id));
  snapshot = { devices, samples };
  for (const listener of listeners) listener();
  for (const car of arrived) for (const listener of carListeners) listener(car);
}

/** Starts or stops following devices to match the settings; asks nothing. */
export async function followDevices(settings: Settings): Promise<void> {
  if (!bluetooth.BLUETOOTH) return;
  const wanted = (settings.headphoneBattery || settings.carModeOffer) && bluetooth.permitted();
  if (!wanted) {
    subscription?.remove();
    subscription = null;
    await bluetooth.stop();
    update([]);
    return;
  }
  if (subscription) return;
  subscription = bluetooth.addChangeListener(update);
  if (await bluetooth.start()) update(bluetooth.devices());
}

/** Asks for “nearby devices” when a setting that needs it is turned on; explains a refusal. */
export async function allowDevices(): Promise<boolean> {
  if (await bluetooth.requestPermission()) return true;
  showAlert(
    t('Nearby devices not allowed'),
    t(
      'Lelap needs it to see which headphones or car are connected. You can allow it in the app’s settings in Android.',
    ),
  );
  return false;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const useDevices = () => useSyncExternalStore(subscribe, () => snapshot);

/**
 * Follows devices while the app runs and offers car mode when a car connects. Re-reads the
 * settings when the library changes, which includes a profile switch.
 */
export function DeviceRunner() {
  const { version } = useLibrary();
  const router = useRouter();
  const settings = useMemo(() => getSettings(db, profileId), [version]);
  useEffect(() => {
    void followDevices(settings).catch(() => {});
  }, [settings]);
  useEffect(() => {
    if (!settings.carModeOffer) return;
    const offer = (car: bluetooth.AudioDevice) =>
      showAlert(
        t('Car mode?'),
        t('Connected to {name}. Big buttons for the road.', { name: car.name }),
        [
          { text: t('Not now'), style: 'cancel' },
          { text: t('Open car mode'), onPress: () => router.push('/car') },
        ],
      );
    carListeners.add(offer);
    return () => {
      carListeners.delete(offer);
    };
  }, [settings.carModeOffer, router]);
  return null;
}

/**
 * The connected headphones or speaker whose battery likely won't last what is coming: the sleep
 * timer, else the rest of the chapter (or file).
 */
export function useHeadphoneWarning(): { name: string; level: number; what: string } | null {
  const { devices, samples } = useDevices();
  const state = usePlayerState();
  const { version } = useLibrary();
  const detail = useMemo(
    () => (state.bookId && devices.length > 0 ? getBook(db, profileId, state.bookId) : null),
    [state.bookId, devices.length, version],
  );
  if (!state.bookId) return null;
  const speed = Math.max(0.5, state.speed);
  let needMs: number | null = null;
  let what = t('It may not last the chapter.');
  if (state.sleepTimerRemainingMs !== null) {
    needMs = state.sleepTimerRemainingMs;
    what = t('It may not last the sleep timer.');
  } else if (detail && detail.chapters.length > 0) {
    const position = toBookPosition(detail.files, state.fileLocation ?? '', state.positionMs);
    const next = detail.chapters[chapterAt(detail.chapters, position) + 1];
    needMs = ((next?.startMs ?? detail.book.durationMs) - position) / speed;
  } else if (state.durationMs > 0) {
    needMs = (state.durationMs - state.positionMs) / speed;
  }
  for (const d of devices) {
    if (d.car || d.battery === null) continue;
    if (headphoneWarning(d.battery, samples.get(d.id) ?? [], needMs)) {
      return { name: d.name, level: d.battery, what: needMs === null ? '' : what };
    }
  }
  return null;
}

/** Like the offline banner: the headphones' battery likely won't last. */
export function HeadphoneBanner({ className = '' }: { className?: string }) {
  const warning = useHeadphoneWarning();
  if (!warning) return null;
  return (
    <View
      accessibilityRole="alert"
      className={`flex-row items-center gap-3 rounded-xl bg-[#2b2414] px-4 py-3 ${className}`}
    >
      <Icon name="headphones" size={20} color="#f7d9a0" />
      <Text className="flex-1 text-sm text-[#f7d9a0]">
        {t('{name} at {level}%.', { name: warning.name, level: warning.level })}{' '}
        {warning.what || t('Charge it soon.')}
      </Text>
    </View>
  );
}
