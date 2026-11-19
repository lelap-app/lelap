import {
  deleteProfile,
  getProfile,
  isPin,
  listAllBooks,
  listProfiles,
  removeFromShelf,
  setPin,
  shelfBookIds,
  updateProfile,
} from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { COLORS, IconButton } from '../src/components/Icon';
import { useAllAddons } from '../src/addons';
import { Avatar, AVATAR_IDS, avatarName } from '../src/components/Avatar';
import { db } from '../src/db';
import { switchProfile, useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { TextButton, Toggle } from '../src/components/TextButton';
import { READABLE } from '../src/layout';

/** One profile: name, avatar, PIN, kids limits, delete. */
export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const addons = useAllAddons();
  // `version` is the signal to re-read the database.
  const profile = useMemo(() => getProfile(db, id), [id, version]);
  const shelf = useMemo(() => {
    if (!profile?.kids) return [];
    const ids = shelfBookIds(db, profile.id);
    return listAllBooks(db, profile.id).filter((b) => ids.has(b.id));
  }, [profile, version]);
  const [name, setName] = useState(profile?.name ?? '');
  const [pin, setPinText] = useState('');

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-night">
        <Text className="text-muted">{t('This profile is gone.')}</Text>
      </View>
    );
  }

  const save = (set: Parameters<typeof updateProfile>[2]) => {
    updateProfile(db, profile.id, set, Date.now());
    refresh();
  };
  const hidden = new Set(profile.hiddenAddons);

  const remove = () =>
    showAlert(
      t('Delete {name}?', { name: profile.name }),
      t(
        'Their places, bookmarks, Up Next, podcasts and settings go too, on every synced device. Downloads stay.',
      ),
      [
        { text: t('Keep'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () =>
            void (async () => {
              if (profile.id === profileId) {
                const other = listProfiles(db).find((p) => p.id !== profile.id);
                if (other) await switchProfile(other.id);
              }
              deleteProfile(db, profile.id, Date.now());
              refresh();
              router.back();
            })(),
        },
      ],
    );

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
          color={COLORS.soft}
          onPress={() => router.back()}
        />
      </View>
      <View className="flex-row items-center gap-4">
        <Avatar avatar={profile.avatar} name={profile.name} size={72} />
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => save({ name })}
          accessibilityLabel={t('Name')}
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-xl text-paper"
        />
      </View>

      <Text accessibilityRole="header" className="text-xs uppercase tracking-wider text-muted">
        {t('Avatar')}
      </Text>
      <View className="flex-row flex-wrap gap-3">
        {AVATAR_IDS.map((a) => (
          <Pressable
            key={a}
            onPress={() => save({ avatar: a })}
            accessibilityRole="radio"
            accessibilityLabel={avatarName(a)}
            accessibilityState={{ checked: profile.avatar === a }}
            aria-checked={profile.avatar === a}
            className={`rounded-2xl border-2 ${profile.avatar === a ? 'border-amber' : 'border-transparent'}`}
          >
            <Avatar avatar={a} name={profile.name} size={52} />
          </Pressable>
        ))}
        <Pressable
          onPress={() => save({ avatar: null })}
          accessibilityRole="radio"
          accessibilityLabel={t('First letter of the name')}
          accessibilityState={{ checked: profile.avatar === null }}
          aria-checked={profile.avatar === null}
          className={`rounded-2xl border-2 ${profile.avatar === null ? 'border-amber' : 'border-transparent'}`}
        >
          <Avatar avatar={null} name={profile.name} size={52} />
        </Pressable>
      </View>

      <Text accessibilityRole="header" className="pt-2 text-xs uppercase tracking-wider text-muted">
        {t('PIN')}
      </Text>
      <Text className="text-sm text-muted">
        {t(
          'A four-digit PIN keeps others from opening this profile on this device. It doesn’t encrypt anything.',
        )}
      </Text>
      <View className="flex-row items-center gap-3">
        <TextInput
          value={pin}
          onChangeText={(t) => setPinText(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          placeholder={profile.pinHash ? t('New PIN') : t('PIN')}
          accessibilityLabel={profile.pinHash ? t('New PIN') : t('PIN')}
          placeholderTextColor={COLORS.muted}
          className="min-h-12 w-32 rounded-lg border border-line px-3 py-2 text-paper"
        />
        <TextButton
          text={t('Set PIN')}
          disabled={!isPin(pin)}
          onPress={() => {
            setPin(db, profile.id, pin, Date.now());
            setPinText('');
            refresh();
          }}
        />
        {profile.pinHash && (
          <TextButton
            text={t('Remove PIN')}
            onPress={() => {
              setPin(db, profile.id, null, Date.now());
              refresh();
            }}
            tone="danger"
          />
        )}
      </View>

      <View className="flex-row items-center gap-3 pt-2">
        <View className="flex-1">
          <Text className="text-paper">{t('Kids profile')}</Text>
          <Text className="text-sm text-muted">
            {t(
              'Can’t change add-ons, servers or backups. Sees only the books on its shelf, and streamed books it starts itself.',
            )}
          </Text>
        </View>
        <Toggle
          accessibilityLabel={t('Kids profile')}
          value={profile.kids}
          onValueChange={(kids) => save({ kids })}
        />
      </View>

      {profile.kids && (
        <>
          <Text
            accessibilityRole="header"
            className="pt-2 text-xs uppercase tracking-wider text-muted"
          >
            {t('Shelf')}
          </Text>
          {shelf.length === 0 ? (
            <Text className="text-sm text-muted">
              {t(
                'Nothing yet. In your own Library, hold a book and choose “Put on a kid’s shelf…”.',
              )}
            </Text>
          ) : (
            shelf.map((b) => (
              <View key={b.id} className="flex-row items-center gap-3 border-b border-line py-2">
                <Text numberOfLines={1} className="flex-1 text-paper">
                  {b.title}
                </Text>
                <TextButton
                  text={t('Remove')}
                  onPress={() => {
                    removeFromShelf(db, profile.id, b.id, Date.now());
                    refresh();
                  }}
                  tone="danger"
                />
              </View>
            ))
          )}
        </>
      )}

      <Text accessibilityRole="header" className="pt-2 text-xs uppercase tracking-wider text-muted">
        {t('Catalogs this profile sees')}
      </Text>
      {addons.map((a) => (
        <View key={a.url} className="flex-row items-center gap-3 border-b border-line py-2">
          <Text className="flex-1 text-paper">{a.manifest.name}</Text>
          <Toggle
            accessibilityLabel={a.manifest.name}
            value={!hidden.has(a.url)}
            onValueChange={(shown) =>
              save({
                hiddenAddons: shown
                  ? profile.hiddenAddons.filter((u) => u !== a.url)
                  : [...profile.hiddenAddons, a.url],
              })
            }
          />
        </View>
      ))}

      <TextButton text={t('Delete this profile')} tone="danger" onPress={remove} />
    </ScrollView>
  );
}
