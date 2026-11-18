import {
  type BatterySample,
  chapterAt,
  closeSession,
  deviceValue,
  type DrainRecord,
  encodeDrainRecord,
  getBook,
  getSettings,
  headphoneWarning,
  isCar,
  markCar,
  type MarkedCar,
  parseDrainRecord,
  parseMarkedCars,
  resumeSession,
  setDeviceValue,
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
// the car mode offer is on. Levels are kept per device while a book plays, to measure drain;
// the drain measured is kept on this device per headphones (M74), and so are the marked cars.
// The levels of the session still open are stored too, and folded in once when it ends (M107).

type Snapshot = {
  /** With `car` true for a marked car too. */
  devices: bluetooth.AudioDevice[];
  samples: Map<string, BatterySample[]>;
  /** Percent per hour each device drained in earlier sessions; null when never measured. */
  learned: Map<string, number | null>;
};

const CARS_KEY = 'bluetoothCars';
const drainKey = (id: string) => `headphoneDrain:${id}`;

// Each device's stored record, read once per connection.
const records = new Map<string, DrainRecord>();

function saveRecord(id: string, record: DrainRecord, now: number): void {
  records.set(id, record);
  setDeviceValue(db, drainKey(id), encodeDrainRecord(record), now);
}

/** The record for a device that just connected: its open session goes on or ends here. */
function connectRecord(id: string, level: number | null, now: number): DrainRecord {
  const stored = records.get(id) ?? parseDrainRecord(deviceValue(db, drainKey(id)));
  const record = resumeSession(stored, now, level);
  if (record !== stored) saveRecord(id, record, now);
  else records.set(id, record);
  return record;
}

let snapshot: Snapshot = { devices: [], samples: new Map(), learned: new Map() };
// What the module last reported, before marked cars count as cars.
let reported: bluetooth.AudioDevice[] = [];
let cars: MarkedCar[] | null = null;

/** Read from the database once, when first needed. */
function markedCars(): MarkedCar[] {
  cars ??= parseMarkedCars(deviceValue(db, CARS_KEY));
  return cars;
}
const listeners = new Set<() => void>();
const carListeners = new Set<(car: bluetooth.AudioDevice) => void>();
let subscription: { remove: () => void } | null = null;
// Levels count only while a book plays: idle earbuds drain slower than listening ones.
let listening = false;

/** Playback started or stopped; a pause ends the measure, the next play starts a new one. */
function setListening(playing: boolean): void {
  if (playing === listening) return;
  listening = playing;
  if (!playing) {
    const now = Date.now();
    const learned = new Map(snapshot.learned);
    for (const [id, record] of records) {
      if (record.session.length === 0) continue;
      const closed = closeSession(record);
      saveRecord(id, closed, now);
      if (learned.has(id)) learned.set(id, closed.learned);
    }
    snapshot = { ...snapshot, samples: new Map(), learned };
  }
  update(reported);
}

function update(found: bluetooth.AudioDevice[]) {
  // Android names some devices nothing; native code leaves the name empty for the app to fill.
  reported = found.map((d) => (d.name ? d : { ...d, name: t('Bluetooth device') }));
  const now = Date.now();
  const marked = markedCars();
  const devices = reported.map((d) => (isCar(d, marked) ? { ...d, car: true } : d));
  const known = new Set(snapshot.devices.map((d) => d.id));
  const wereCars = new Set(snapshot.devices.filter((d) => d.car).map((d) => d.id));
  const samples = new Map<string, BatterySample[]>();
  const learned = new Map<string, number | null>();
  for (const d of devices) {
    let before = snapshot.samples.get(d.id) ?? [];
    let earlier = snapshot.learned.get(d.id) ?? null;
    if ((!known.has(d.id) || wereCars.has(d.id)) && !d.car) {
      // Connected, unmarked as a car, or the app started mid-session: go on from what was stored.
      const record = connectRecord(d.id, d.battery, now);
      before = record.session;
      earlier = record.learned;
    }
    const last = before.at(-1);
    const next =
      listening && d.battery !== null && last?.level !== d.battery
        ? [...before, { at: now, level: d.battery }]
        : before;
    // Up to 20 h of steps of ten, so a whole session's drain can be measured.
    samples.set(d.id, next.slice(-40));
    learned.set(d.id, earlier);
    if (next !== before && !d.car) {
      // Stored as the open session; it joins the learned drain once, when it ends.
      saveRecord(d.id, { learned: earlier, session: next.slice(-40) }, now);
    }
  }
  const arrived = devices.filter((d) => d.car && !known.has(d.id));
  snapshot = { devices, samples, learned };
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

/** Marks a Bluetooth device as the listener's car, or not, on this device. */
export function setMarkedCar(device: MarkedCar, car: boolean): void {
  cars = markCar(markedCars(), device, car);
  setDeviceValue(db, CARS_KEY, JSON.stringify(cars), Date.now());
  update(reported);
}

/**
 * For Settings: the marked cars and the audio devices connected now that Bluetooth does not
 * already call a car, each with whether it is marked and connected.
 */
export function useCarChoices(): {
  id: string;
  name: string;
  marked: boolean;
  connected: boolean;
}[] {
  // Re-renders whenever the devices or the marks change.
  useDevices();
  const choices = new Map<
    string,
    { id: string; name: string; marked: boolean; connected: boolean }
  >();
  for (const c of markedCars()) choices.set(c.id, { ...c, marked: true, connected: false });
  for (const d of reported) {
    if (d.car) continue;
    const marked = choices.has(d.id);
    choices.set(d.id, { id: d.id, name: d.name, marked, connected: true });
  }
  return [...choices.values()];
}

/**
 * Follows devices while the app runs and offers car mode when a car connects. Re-reads the
 * settings when the library changes, which includes a profile switch.
 */
export function DeviceRunner() {
  const { version } = useLibrary();
  const { playing } = usePlayerState();
  const router = useRouter();
  const settings = useMemo(() => getSettings(db, profileId), [version]);
  useEffect(() => {
    void followDevices(settings).catch(() => {});
  }, [settings]);
  useEffect(() => setListening(playing), [playing]);
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
  const { devices, samples, learned } = useDevices();
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
    if (headphoneWarning(d.battery, samples.get(d.id) ?? [], needMs, learned.get(d.id) ?? null)) {
      return { name: d.name, level: d.battery, what: needMs === null ? '' : what };
    }
  }
  return null;
}

/** Like the offline banner: the headphones' battery likely won't last. */
export function HeadphoneBanner({
  className = '',
  large = false,
}: {
  className?: string;
  /** Car mode: no text under 18 points. */
  large?: boolean;
}) {
  const warning = useHeadphoneWarning();
  if (!warning) return null;
  return (
    <View
      accessibilityRole="alert"
      className={`flex-row items-center gap-3 rounded-xl bg-[#2b2414] px-4 py-3 ${className}`}
    >
      <Icon name="headphones" size={large ? 28 : 20} color="#f7d9a0" />
      <Text className={`flex-1 ${large ? 'text-lg' : 'text-sm'} text-[#f7d9a0]`}>
        {t('{name} at {level}%.', { name: warning.name, level: warning.level })}{' '}
        {warning.what || t('Charge it soon.')}
      </Text>
    </View>
  );
}
