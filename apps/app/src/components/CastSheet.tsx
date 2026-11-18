import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import {
  addDevicesListener,
  addDiscoveryListener,
  type CastDevice,
  type DiscoveryReport,
  isLocalNetworkDenied,
  listDevices,
  localNetworkAccess,
  type LocalNetworkAccess,
  requestLocalNetworkAccess,
  setCastVolume,
  startCasting,
  startDiscovery,
  stopCasting,
  stopDiscovery,
  useCasting,
} from '../casting';
import { t } from '../i18n';
import { bookLoad } from '../player';
import { COLORS, Icon } from './Icon';
import { Sheet } from './Sheet';

/** How long a search finds nothing before the sheet says so; most devices answer in a few seconds. */
const QUIET_AFTER_MS = 12_000;

/** NsdManager's FAILURE_PERMISSION_DENIED, which the cast module also reports without access. */
const NO_LOCAL_NETWORK = 7;

/** `startDiscovery()` itself rejected; -1 is the cast module's code for a call that threw. */
const START_THREW: DiscoveryReport = {
  searching: false,
  problem: 'start-failed',
  code: -1,
  found: 0,
  added: 0,
};

const KIND: Record<CastDevice['kind'], string> = {
  upnp: 'UPnP',
  cast: 'Google Cast',
  fcast: 'FCast',
};

function Chip({ label, spoken, onPress }: { label: string; spoken?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...(spoken === undefined ? {} : { accessibilityLabel: spoken })}
      className="min-h-12 justify-center rounded-full border border-line px-4 active:bg-night"
    >
      <Text className="text-soft">{label}</Text>
    </Pressable>
  );
}

/** Picks a speaker or TV on the Wi-Fi to play the loaded book on, or hands it back. */
export function CastSheet({
  visible,
  bookId,
  onClose,
}: {
  visible: boolean;
  bookId: string;
  onClose: () => void;
}) {
  const casting = useCasting();
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [access, setAccess] = useState<LocalNetworkAccess | null>(null);
  // Bumped by "Search again"; `quiet` is set when a search has found nothing for a while.
  const [search, setSearch] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [report, setReport] = useState<DiscoveryReport | null>(null);

  // Android 17 asks before an app reaches the Wi-Fi's devices; the sheet explains first.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    void localNetworkAccess()
      .then((answer) => {
        if (live) setAccess(answer);
      })
      .catch(() => {
        if (live) setAccess('granted');
      });
    return () => {
      live = false;
    };
  }, [visible]);

  // Looks only while the sheet is open: discovery keeps Wi-Fi multicast on.
  useEffect(() => {
    if (!visible || access !== 'granted') return;
    const subscription = addDevicesListener(setDevices);
    const reports = addDiscoveryListener((next) => {
      // Android said no after all: show the explanation again instead of a failed search.
      if (next.problem === 'start-failed' && next.code === NO_LOCAL_NETWORK) {
        void localNetworkAccess().then(setAccess);
      }
      setReport(next);
    });
    setReport(null);
    void listDevices().then(setDevices);
    void startDiscovery().catch(() => setReport(START_THREW));
    setQuiet(false);
    const timer = setTimeout(() => setQuiet(true), QUIET_AFTER_MS);
    return () => {
      clearTimeout(timer);
      subscription.remove();
      reports.remove();
      void stopDiscovery();
    };
  }, [visible, access, search]);

  const pick = async (device: CastDevice) => {
    if (device.id === casting.device?.id) return;
    const book = bookLoad(bookId);
    if (!book) return;
    setConnecting(device.id);
    try {
      await startCasting(device, book);
      onClose();
    } catch (e) {
      // useCasting carries the message; a missing permission brings back the explanation.
      if (isLocalNetworkDenied(e)) setAccess(await localNetworkAccess());
    } finally {
      setConnecting(null);
    }
  };

  const startFailed = report?.problem === 'start-failed' ? report.code : null;
  const unreachable =
    report !== null &&
    report.problem !== null &&
    report.problem !== 'start-failed' &&
    devices.length === 0
      ? report.found
      : 0;

  const volume = casting.volume;
  const changeVolume = (delta: number) => {
    if (volume === null) return;
    void setCastVolume(Math.min(1, Math.max(0, Math.round((volume + delta) * 10) / 10)));
  };

  return (
    <Sheet visible={visible} title={t('Play on')} onClose={onClose}>
      {casting.device && (
        <View className="gap-3 pb-4">
          <Text className="text-soft">
            {t('Playing on')} <Text className="text-amber">{casting.device.name}</Text>
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {volume !== null && (
              <>
                <Chip
                  label={t('Volume −')}
                  spoken={t('Volume down')}
                  onPress={() => changeVolume(-0.1)}
                />
                <Text className="w-12 text-center text-soft">{Math.round(volume * 100)}%</Text>
                <Chip
                  label={t('Volume +')}
                  spoken={t('Volume up')}
                  onPress={() => changeVolume(0.1)}
                />
              </>
            )}
            <Chip
              label={t('Play on this phone')}
              onPress={() => {
                void stopCasting();
                onClose();
              }}
            />
          </View>
        </View>
      )}
      {casting.error !== null && <Text className="pb-3 text-sm text-danger">{casting.error}</Text>}
      {access === 'ask' && (
        <View className="gap-3 pb-4">
          <Text className="text-soft">
            {t(
              'To find speakers and TVs, Lelap needs Android’s “nearby devices” permission. It only looks on this Wi-Fi, and only while this sheet is open.',
            )}
          </Text>
          <View className="flex-row">
            <Chip
              label={t('Allow')}
              onPress={() => void requestLocalNetworkAccess().then(setAccess)}
            />
          </View>
        </View>
      )}
      {access === 'blocked' && (
        <View className="gap-3 pb-4">
          <Text className="text-soft">
            {t(
              '“Nearby devices” is off for Lelap, so it can’t find speakers and TVs. Turn it on in Android’s settings.',
            )}
          </Text>
          <View className="flex-row">
            <Chip label={t('Open settings')} onPress={() => void Linking.openSettings()} />
          </View>
        </View>
      )}
      {access === 'granted' && (
        <ScrollView>
          {devices.map((device) => {
            const current = device.id === casting.device?.id;
            return (
              <Pressable
                key={device.id}
                onPress={() => void pick(device)}
                disabled={connecting !== null}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                aria-selected={current}
                className="min-h-12 flex-row items-center gap-3 py-3 active:opacity-60"
              >
                <Icon name="cast" size={22} color={current ? COLORS.amber : COLORS.soft} />
                <View className="flex-1">
                  <Text numberOfLines={1} className={current ? 'text-amber' : 'text-paper'}>
                    {device.name}
                  </Text>
                  <Text numberOfLines={1} className="text-xs text-muted">
                    {[device.model, KIND[device.kind]].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {connecting === device.id && <ActivityIndicator color={COLORS.amber} />}
              </Pressable>
            );
          })}
          {startFailed !== null ? (
            <View className="gap-3 py-3">
              <Text className="text-paper">
                {t(
                  'Lelap couldn’t start looking for Google Cast and FCast devices (code {code}).',
                  {
                    code: startFailed,
                  },
                )}
              </Text>
              <View className="flex-row">
                <Chip label={t('Search again')} onPress={() => setSearch((n) => n + 1)} />
              </View>
            </View>
          ) : quiet && devices.length === 0 ? (
            <View className="gap-3 py-3">
              <Text className="text-paper">{t('No speakers or TVs found on this Wi-Fi.')}</Text>
              {unreachable > 0 && (
                <Text className="text-sm text-muted">
                  {unreachable === 1
                    ? t('Lelap found 1 Google Cast or FCast device but couldn’t reach it.')
                    : t('Lelap found {n} Google Cast or FCast devices but couldn’t reach them.', {
                        n: unreachable,
                      })}
                </Text>
              )}
              <Text className="text-sm text-muted">
                {t(
                  'Check that the speaker or TV is on and on the same Wi-Fi as this phone. Guest networks, some mesh and office networks, and a VPN on the phone stop devices from seeing each other.',
                )}
              </Text>
              <View className="flex-row">
                <Chip label={t('Search again')} onPress={() => setSearch((n) => n + 1)} />
              </View>
            </View>
          ) : (
            <View className="flex-row items-center gap-3 py-3">
              <ActivityIndicator color={COLORS.muted} />
              <Text className="flex-1 text-sm text-muted">
                {t(
                  'Looking for speakers and TVs on this Wi-Fi. Sonos, DLNA, Google Cast and FCast receivers play the book themselves; files on this phone are shared with them only while casting.',
                )}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </Sheet>
  );
}
