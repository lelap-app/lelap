import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLibrary } from '../src/player';
import {
  defaultDeviceName,
  joinSyncing,
  makePairingCode,
  membership,
  removedAt,
  resetSyncing,
  startSyncing,
  stopSyncing,
  syncOnce,
} from '../src/sync';

const CODE_MINUTES = 10;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Sync between devices: no account, a group key shared with a pairing code. */
export default function SyncScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  const [member, setMember] = useState(membership);
  const [name, setName] = useState(defaultDeviceName());
  const [code, setCode] = useState('');
  const [offered, setOffered] = useState<{ code: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [removed, setRemoved] = useState(removedAt);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!offered) return;
    const timer = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [offered]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      Alert.alert('Sync', message(error));
    } finally {
      setBusy(false);
      setMember(membership());
      setRemoved(removedAt());
      refresh();
    }
  };

  const left = offered ? Math.max(0, Math.ceil((offered.until - Date.now()) / 1000)) : 0;

  return (
    <ScrollView
      className="flex-1 bg-night"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 32,
        gap: 16,
      }}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} className="self-start py-2">
        <Text className="text-2xl text-muted">‹</Text>
      </Pressable>
      <Text className="text-3xl font-semibold text-paper">Sync</Text>
      <Text className="text-soft">
        Your places, bookmarks, streamed books, podcasts and Up Next follow you between your
        devices. Everything is encrypted on this device with a key only your devices have; the
        server stores what it cannot read. No account.
      </Text>

      {busy && <ActivityIndicator color="#f5b041" />}

      {!member ? (
        <View className="gap-4">
          {removed && (
            <Text className="text-amber">
              Another device reset sync, so this one stopped syncing. Your library is still here.
              Join again with a code from one of your devices.
            </Text>
          )}
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted">This device</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name, such as Kitchen tablet"
              placeholderTextColor="#8d8a83"
              className="rounded-lg border border-line px-3 py-2 text-paper"
            />
          </View>
          <Pressable
            disabled={busy}
            onPress={() =>
              void run(async () => void (await startSyncing(name.trim() || defaultDeviceName())))
            }
            className="items-center rounded-full bg-amber py-3 active:opacity-80"
          >
            <Text className="font-semibold text-ink">Start syncing from this device</Text>
          </Pressable>
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted">
              Or join with a code from another device
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="7KQM-2XPA-9HRT"
                placeholderTextColor="#8d8a83"
                autoCapitalize="characters"
                autoCorrect={false}
                className="flex-1 rounded-lg border border-line px-3 py-2 font-mono text-paper"
              />
              <Pressable
                disabled={busy || code.trim() === ''}
                onPress={() =>
                  void run(async () => {
                    await joinSyncing(code, name.trim() || defaultDeviceName());
                    setCode('');
                    await syncOnce();
                  })
                }
              >
                <Text className={code.trim() === '' ? 'text-muted' : 'text-amber'}>Join</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View className="gap-4">
          <Text className="text-paper">
            Syncing as {member.deviceName}
            {member.lastSyncAt ? ` · last ${new Date(member.lastSyncAt).toLocaleTimeString()}` : ''}
          </Text>
          <Pressable disabled={busy} onPress={() => void run(async () => void (await syncOnce()))}>
            <Text className="text-amber">Sync now</Text>
          </Pressable>

          <View className="gap-2 rounded-xl border border-line p-3">
            <Text className="text-paper">Add a device</Text>
            {offered && left > 0 ? (
              <>
                <Text selectable className="font-mono text-3xl tracking-widest text-amber">
                  {offered.code}
                </Text>
                <Text className="text-sm text-muted">
                  Type this on the other device under Settings → Sync → Join. Works once, for{' '}
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.
                </Text>
              </>
            ) : (
              <Pressable
                disabled={busy}
                onPress={() =>
                  void run(async () =>
                    setOffered({
                      code: await makePairingCode(),
                      until: Date.now() + CODE_MINUTES * 60_000,
                    }),
                  )
                }
              >
                <Text className="text-amber">Show a pairing code</Text>
              </Pressable>
            )}
          </View>

          <View className="gap-2 rounded-xl border border-line p-3">
            <Text className="text-paper">Remove a lost device</Text>
            <Text className="text-sm text-muted">
              Starts a new sync group with a new key and deletes the old one from the server, so a
              lost or sold device can't read anything from now on. Your other devices stop syncing
              until you add them again with a pairing code.
            </Text>
            {confirmReset ? (
              <View className="flex-row gap-6">
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      setConfirmReset(false);
                      setOffered(null);
                      await resetSyncing();
                      await syncOnce();
                    })
                  }
                >
                  <Text className="text-danger">Reset sync</Text>
                </Pressable>
                <Pressable onPress={() => setConfirmReset(false)}>
                  <Text className="text-muted">Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable disabled={busy} onPress={() => setConfirmReset(true)}>
                <Text className="text-amber">Remove a lost device…</Text>
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={() =>
              Alert.alert(
                'Stop syncing on this device?',
                'Your library stays here. Other devices keep syncing with each other.',
                [
                  { text: 'Keep syncing', style: 'cancel' },
                  {
                    text: 'Stop',
                    style: 'destructive',
                    onPress: () => {
                      stopSyncing();
                      setMember(null);
                    },
                  },
                ],
              )
            }
          >
            <Text className="text-danger">Stop syncing on this device</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
