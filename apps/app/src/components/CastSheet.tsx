import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import {
  addDevicesListener,
  type CastDevice,
  listDevices,
  setCastVolume,
  startCasting,
  startDiscovery,
  stopCasting,
  stopDiscovery,
  useCasting,
} from '../casting';
import { bookLoad } from '../player';
import { COLORS, Icon } from './Icon';
import { Sheet } from './Sheet';

const KIND: Record<CastDevice['kind'], string> = {
  upnp: 'UPnP',
  cast: 'Google Cast',
  fcast: 'FCast',
};

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-full border border-line px-4 py-2 active:bg-night"
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

  // Looks only while the sheet is open: discovery keeps Wi-Fi multicast on.
  useEffect(() => {
    if (!visible) return;
    const subscription = addDevicesListener(setDevices);
    void listDevices().then(setDevices);
    void startDiscovery();
    return () => {
      subscription.remove();
      void stopDiscovery();
    };
  }, [visible]);

  const pick = async (device: CastDevice) => {
    if (device.id === casting.device?.id) return;
    const book = bookLoad(bookId);
    if (!book) return;
    setConnecting(device.id);
    try {
      await startCasting(device, book);
      onClose();
    } catch {
      // useCasting carries the message.
    } finally {
      setConnecting(null);
    }
  };

  const volume = casting.volume;
  const changeVolume = (delta: number) => {
    if (volume === null) return;
    void setCastVolume(Math.min(1, Math.max(0, Math.round((volume + delta) * 10) / 10)));
  };

  return (
    <Sheet visible={visible} title="Play on" onClose={onClose}>
      {casting.device && (
        <View className="gap-3 pb-4">
          <Text className="text-soft">
            Playing on <Text className="text-amber">{casting.device.name}</Text>
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {volume !== null && (
              <>
                <Chip label="Volume −" onPress={() => changeVolume(-0.1)} />
                <Text className="w-12 text-center text-soft">{Math.round(volume * 100)}%</Text>
                <Chip label="Volume +" onPress={() => changeVolume(0.1)} />
              </>
            )}
            <Chip
              label="Play on this phone"
              onPress={() => {
                void stopCasting();
                onClose();
              }}
            />
          </View>
        </View>
      )}
      {casting.error !== null && <Text className="pb-3 text-sm text-danger">{casting.error}</Text>}
      <ScrollView>
        {devices.map((device) => {
          const current = device.id === casting.device?.id;
          return (
            <Pressable
              key={device.id}
              onPress={() => void pick(device)}
              disabled={connecting !== null}
              accessibilityRole="button"
              className="flex-row items-center gap-3 py-3 active:opacity-60"
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
        <View className="flex-row items-center gap-3 py-3">
          <ActivityIndicator color={COLORS.muted} />
          <Text className="flex-1 text-sm text-muted">
            Looking for speakers and TVs on this Wi-Fi. Sonos, DLNA, Google Cast and FCast receivers
            play the book themselves; files on this phone are shared with them only while casting.
          </Text>
        </View>
      </ScrollView>
    </Sheet>
  );
}
