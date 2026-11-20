import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { castGroupsHere } from '@lelap/core';

import {
  addDevicesListener,
  addDiscoveryListener,
  type CastDevice,
  connectAnyway,
  type DiscoveryReport,
  forgetGroup,
  isLocalNetworkDenied,
  joinSpeaker,
  leaveSpeaker,
  listDevices,
  localNetworkAccess,
  type LocalNetworkAccess,
  rememberedGroups,
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
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { useColors } from '../theme';

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
  const colors = useColors();
  const casting = useCasting();
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [access, setAccess] = useState<LocalNetworkAccess | null>(null);
  // Bumped by "Search again"; `quiet` is set when a search has found nothing for a while.
  const [search, setSearch] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  // Choosing speakers for a group (M78): the ticked ones in the order they were ticked, the
  // first leading; null when a tap plays on one.
  const [group, setGroup] = useState<string[] | null>(null);
  // Groups played on before (M125), read again each time the sheet opens.
  const [remembered, setRemembered] = useState(rememberedGroups);
  useEffect(() => {
    if (visible) setRemembered(rememberedGroups());
  }, [visible]);

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

  const playingOn = (device: CastDevice) =>
    device.id === casting.device?.id ||
    (casting.device?.members.some((m) => m.id === device.id) ?? false);

  const connect = async (busy: string, start: () => Promise<void>) => {
    setConnecting(busy);
    try {
      await start();
      setGroup(null);
      onClose();
    } catch (e) {
      // useCasting carries the message; a missing permission brings back the explanation.
      if (isLocalNetworkDenied(e)) setAccess(await localNetworkAccess());
    } finally {
      setConnecting(null);
    }
  };

  const play = (chosen: CastDevice[], busy?: string) => {
    const book = bookLoad(bookId);
    const first = chosen[0];
    if (!book || !first) return;
    void connect(busy ?? first.id, () => startCasting(chosen, book));
  };

  // Joining or leaving keeps the sheet open: the listener may add or take out more.
  const change = async (busy: string, run: () => Promise<void>) => {
    setConnecting(busy);
    try {
      await run();
      setRemembered(rememberedGroups());
    } catch (e) {
      if (isLocalNetworkDenied(e)) setAccess(await localNetworkAccess());
    } finally {
      setConnecting(null);
    }
  };

  const sessionIds = casting.device?.members.map((m) => m.id) ?? null;
  const groupsHere =
    group === null
      ? castGroupsHere(remembered, new Set(devices.map((d) => d.id)), sessionIds).flatMap((g) => {
          const members = g.ids.flatMap((id) => devices.filter((d) => d.id === id));
          return members.length === g.ids.length ? [{ ids: g.ids, members }] : [];
        })
      : [];

  const pick = (device: CastDevice) => {
    if (group !== null) {
      setGroup(
        group.includes(device.id) ? group.filter((id) => id !== device.id) : [...group, device.id],
      );
      return;
    }
    if (device.id === casting.device?.id) return;
    play([device]);
  };

  const chosen =
    group === null
      ? []
      : group.flatMap((id) => {
          const device = devices.find((d) => d.id === id);
          return device ? [device] : [];
        });

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
      {casting.notice !== null && (
        <Text accessibilityLiveRegion="polite" className="pb-3 text-sm text-muted">
          {casting.notice}
        </Text>
      )}
      {casting.error !== null && (
        <View className="gap-3 pb-3">
          <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
            {casting.error}
          </Text>
          {casting.untrusted && (
            <>
              <Text className="text-sm text-muted">
                {t(
                  'Someone on this Wi-Fi may be posing as the speaker. If it’s yours, connect anyway; Lelap asks again after a restart.',
                )}
              </Text>
              <View className="flex-row">
                <Chip
                  label={t('Connect anyway')}
                  onPress={() => {
                    const book = bookLoad(bookId);
                    if (!book) return;
                    // A speaker refused while joining keeps the sheet open, like Add.
                    if (casting.device) void change('anyway', () => connectAnyway(book));
                    else void connect('anyway', () => connectAnyway(book));
                  }}
                />
              </View>
            </>
          )}
        </View>
      )}
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
          {devices.length > 1 && (
            <View className="flex-row flex-wrap items-center gap-2 pb-2">
              {group === null ? (
                <Chip label={t('Play on several')} onPress={() => setGroup([])} />
              ) : (
                <>
                  {chosen.length >= 2 && (
                    <Chip
                      label={t('Play on {n} speakers', { n: chosen.length })}
                      onPress={() => play(chosen)}
                    />
                  )}
                  <Chip label={t('Cancel')} onPress={() => setGroup(null)} />
                  {chosen.length < 2 && (
                    <Text className="flex-1 text-sm text-muted">
                      {t('Tick two or more. They play the book together, kept in step.')}
                    </Text>
                  )}
                </>
              )}
            </View>
          )}
          {groupsHere.map((g) => {
            const name = g.members.map((m) => m.name).join(' + ');
            const busy = `group:${g.ids.join('+')}`;
            return (
              <View key={busy} className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => play(g.members, busy)}
                  disabled={connecting !== null}
                  accessibilityRole="button"
                  className="min-h-12 flex-1 flex-row items-center gap-3 py-3 active:opacity-60"
                >
                  <Icon name="cast" size={22} color={colors.soft} />
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-paper">
                      {name}
                    </Text>
                    <Text numberOfLines={1} className="text-xs text-muted">
                      {t('Played together before')}
                    </Text>
                  </View>
                  {connecting === busy && <ActivityIndicator color={colors.amber} />}
                </Pressable>
                <Chip
                  label={t('Forget')}
                  spoken={t('Forget {name}', { name })}
                  onPress={() => {
                    forgetGroup(g.ids);
                    setRemembered(rememberedGroups());
                  }}
                />
              </View>
            );
          })}
          {devices.map((device) => {
            const current = playingOn(device);
            const ticked = group?.includes(device.id) ?? false;
            const highlighted = group === null ? current : ticked;
            // While a session plays (M125): any other speaker can join it, and any of a group's
            // can leave; when the leading one does, the next leads (M139).
            const canJoin = group === null && casting.device !== null && !current;
            const canLeave =
              group === null && current && sessionIds !== null && sessionIds.length > 1;
            return (
              <View key={device.id} className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => pick(device)}
                  disabled={connecting !== null}
                  accessibilityRole={group === null ? 'button' : 'checkbox'}
                  accessibilityState={group === null ? { selected: current } : { checked: ticked }}
                  {...(group === null ? { 'aria-selected': current } : { 'aria-checked': ticked })}
                  className="min-h-12 flex-1 flex-row items-center gap-3 py-3 active:opacity-60"
                >
                  <Icon
                    name={group !== null && ticked ? 'check' : 'cast'}
                    size={22}
                    color={highlighted ? colors.amber : colors.soft}
                  />
                  <View className="flex-1">
                    <Text numberOfLines={1} className={highlighted ? 'text-amber' : 'text-paper'}>
                      {device.name}
                    </Text>
                    <Text numberOfLines={1} className="text-xs text-muted">
                      {[device.model, KIND[device.kind]].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {connecting === device.id && <ActivityIndicator color={colors.amber} />}
                </Pressable>
                {canJoin && (
                  <Chip
                    label={t('Add')}
                    spoken={t('Add {name} to the speakers playing', { name: device.name })}
                    onPress={() => {
                      if (connecting === null) void change(device.id, () => joinSpeaker(device));
                    }}
                  />
                )}
                {canLeave && (
                  <Chip
                    label={t('Take out')}
                    spoken={t('Take {name} out of the group', { name: device.name })}
                    onPress={() => {
                      if (connecting === null) void change(device.id, () => leaveSpeaker(device));
                    }}
                  />
                )}
              </View>
            );
          })}
          {startFailed !== null ? (
            <View className="gap-3 py-3">
              <Text className="text-paper" accessibilityLiveRegion="polite">
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
              <ActivityIndicator color={colors.muted} />
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
