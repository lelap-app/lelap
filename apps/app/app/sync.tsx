import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { formatTime } from '../src/format';
import { showAlert } from '../src/dialog';
import { IconButton } from '../src/components/Icon';
import { useLibrary } from '../src/player';
import {
  defaultDeviceName,
  joinSyncing,
  makePairingCode,
  membership,
  removal,
  resetSyncing,
  startSyncing,
  stopSyncing,
  syncOnce,
} from '../src/sync';
import { TextButton } from '../src/components/TextButton';
import { READABLE } from '../src/layout';
import { useColors } from '../src/theme';

const CODE_MINUTES = 10;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Sync between devices: no account, a group key shared with a pairing code. */
export default function SyncScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  const [member, setMember] = useState(membership);
  const [name, setName] = useState(defaultDeviceName());
  const [code, setCode] = useState('');
  const [offered, setOffered] = useState<{ code: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [removed, setRemoved] = useState(removal);
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
      showAlert(t('Sync'), message(error));
    } finally {
      setBusy(false);
      setMember(membership());
      setRemoved(removal());
      refresh();
    }
  };

  const left = offered ? Math.max(0, Math.ceil((offered.until - Date.now()) / 1000)) : 0;

  return (
    <ScrollView
      className="flex-1 bg-night"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        ...READABLE,
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 32,
        gap: 16,
      }}
    >
      <View className="-ms-2 self-start">
        <IconButton
          name="back"
          label={t('Back')}
          color={colors.soft}
          onPress={() => router.back()}
        />
      </View>
      <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
        {t('Sync')}
      </Text>
      <Text className="text-soft">
        {t(
          'Your places, bookmarks, streamed books, podcasts and Up Next follow you between your devices. Everything is encrypted on this device with a key only your devices have; the server stores what it cannot read. No account.',
        )}
      </Text>

      {busy && <ActivityIndicator color={colors.amber} />}

      {!member ? (
        <View className="gap-4">
          {removed && (
            <Text className="text-amber">
              {removed.reason === 'restore'
                ? t(
                    'The sync key stays on the phone it was made on and is not in backups. Your library is here; join again with a code from one of your devices.',
                  )
                : t(
                    'Sync stopped on this device: another device reset it, or no device synced for a long time. Your library is still here. Join again with a code from one of your devices.',
                  )}
            </Text>
          )}
          <View className="gap-2">
            <Text
              accessibilityRole="header"
              className="text-xs uppercase tracking-wider text-muted"
            >
              {t('This device')}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('Name, such as Kitchen tablet')}
              accessibilityLabel={t('Name of this device')}
              placeholderTextColor={colors.muted}
              className="min-h-12 rounded-lg border border-line px-3 py-2 text-paper"
            />
          </View>
          <Pressable
            disabled={busy}
            onPress={() =>
              void run(async () => void (await startSyncing(name.trim() || defaultDeviceName())))
            }
            accessibilityRole="button"
            className="min-h-12 items-center justify-center rounded-full bg-amber py-3 active:opacity-80"
          >
            <Text className="font-semibold text-ink">{t('Start syncing from this device')}</Text>
          </Pressable>
          <View className="gap-2">
            <Text
              accessibilityRole="header"
              className="text-xs uppercase tracking-wider text-muted"
            >
              {t('Or join with a code from another device')}
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder={'7KQM-2XPA-9HRT'}
                accessibilityLabel={t('Code from another device')}
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                className="min-h-12 min-w-0 flex-1 rounded-lg border border-line px-3 py-2 font-mono text-paper"
              />
              <TextButton
                text={t('Join')}
                disabled={busy || code.trim() === ''}
                onPress={() =>
                  void run(async () => {
                    await joinSyncing(code, name.trim() || defaultDeviceName());
                    setCode('');
                    await syncOnce();
                  })
                }
              />
            </View>
          </View>
        </View>
      ) : (
        <View className="gap-4">
          <Text className="text-paper">
            {t('Syncing as {name}', { name: member.deviceName })}
            {member.lastSyncAt
              ? ` · ${t('last {time}', { time: formatTime(member.lastSyncAt) })}`
              : ''}
          </Text>
          <TextButton
            text={t('Sync now')}
            disabled={busy}
            onPress={() => void run(async () => void (await syncOnce()))}
          />

          <View className="gap-2 rounded-xl border border-line p-3">
            <Text className="text-paper">{t('Add a device')}</Text>
            {offered && left > 0 ? (
              <>
                <Text selectable className="font-mono text-3xl tracking-widest text-amber">
                  {offered.code}
                </Text>
                <Text className="text-sm text-muted">
                  {t(
                    'Type this on the other device under Settings → People and devices → Sync → Join. Works once, for {time} more.',
                    { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` },
                  )}
                </Text>
              </>
            ) : (
              <TextButton
                text={t('Show a pairing code')}
                disabled={busy}
                onPress={() =>
                  void run(async () =>
                    setOffered({
                      code: await makePairingCode(),
                      until: Date.now() + CODE_MINUTES * 60_000,
                    }),
                  )
                }
              />
            )}
          </View>

          <View className="gap-2 rounded-xl border border-line p-3">
            <Text className="text-paper">{t('Remove a lost device')}</Text>
            <Text className="text-sm text-muted">
              {t(
                "Starts a new sync group with a new key and deletes the old one from the server, so a lost or sold device can't read anything from now on. Your other devices stop syncing until you add them again with a pairing code.",
              )}
            </Text>
            {confirmReset ? (
              <View className="flex-row gap-6">
                <TextButton
                  text={t('Reset sync')}
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      setConfirmReset(false);
                      setOffered(null);
                      await resetSyncing();
                      await syncOnce();
                    })
                  }
                  tone="danger"
                />
                <TextButton
                  text={t('Cancel')}
                  onPress={() => setConfirmReset(false)}
                  tone="muted"
                />
              </View>
            ) : (
              <TextButton
                text={t('Remove a lost device…')}
                disabled={busy}
                onPress={() => setConfirmReset(true)}
              />
            )}
          </View>

          <TextButton
            text={t('Stop syncing on this device')}
            onPress={() =>
              showAlert(
                t('Stop syncing on this device?'),
                t('Your library stays here. Other devices keep syncing with each other.'),
                [
                  { text: t('Keep syncing'), style: 'cancel' },
                  {
                    text: t('Stop'),
                    style: 'destructive',
                    onPress: () => {
                      stopSyncing();
                      setMember(null);
                    },
                  },
                ],
              )
            }
            tone="danger"
          />
        </View>
      )}
    </ScrollView>
  );
}
