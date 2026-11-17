import { deleteProfile, getProfile, isPin, listProfiles, setPin, updateProfile } from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '../src/dialog';
import { COLORS, IconButton } from '../src/components/Icon';
import { useAllAddons } from '../src/addons';
import { Avatar, AVATAR_IDS } from '../src/components/Avatar';
import { db } from '../src/db';
import { switchProfile, useLibrary } from '../src/player';
import { profileId } from '../src/profile';

/** One profile: name, avatar, PIN, kids limits, delete. */
export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const addons = useAllAddons();
  // `version` is the signal to re-read the database.
  const profile = useMemo(() => getProfile(db, id), [id, version]);
  const [name, setName] = useState(profile?.name ?? '');
  const [pin, setPinText] = useState('');

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-night">
        <Text className="text-muted">This profile is gone.</Text>
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
      `Delete ${profile.name}?`,
      'Their places, bookmarks, Up Next, podcasts and settings go too, on every synced device. Downloads stay.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
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
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 32,
        gap: 16,
      }}
    >
      <View className="-ml-2 self-start">
        <IconButton name="back" label="Back" color={COLORS.soft} onPress={() => router.back()} />
      </View>
      <View className="flex-row items-center gap-4">
        <Avatar avatar={profile.avatar} name={profile.name} size={72} />
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => save({ name })}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-xl text-paper"
        />
      </View>

      <Text className="text-xs uppercase tracking-wider text-muted">Avatar</Text>
      <View className="flex-row flex-wrap gap-3">
        {AVATAR_IDS.map((a) => (
          <Pressable
            key={a}
            onPress={() => save({ avatar: a })}
            className={`rounded-2xl border-2 ${profile.avatar === a ? 'border-amber' : 'border-transparent'}`}
          >
            <Avatar avatar={a} name={profile.name} size={52} />
          </Pressable>
        ))}
        <Pressable
          onPress={() => save({ avatar: null })}
          className={`rounded-2xl border-2 ${profile.avatar === null ? 'border-amber' : 'border-transparent'}`}
        >
          <Avatar avatar={null} name={profile.name} size={52} />
        </Pressable>
      </View>

      <Text className="pt-2 text-xs uppercase tracking-wider text-muted">PIN</Text>
      <Text className="text-sm text-muted">
        A four-digit PIN keeps others from opening this profile on this device. It doesn’t encrypt
        anything.
      </Text>
      <View className="flex-row items-center gap-3">
        <TextInput
          value={pin}
          onChangeText={(t) => setPinText(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          placeholder={profile.pinHash ? 'New PIN' : 'PIN'}
          placeholderTextColor="#8d8a83"
          className="w-32 rounded-lg border border-line px-3 py-2 text-paper"
        />
        <Pressable
          disabled={!isPin(pin)}
          onPress={() => {
            setPin(db, profile.id, pin, Date.now());
            setPinText('');
            refresh();
          }}
        >
          <Text className={isPin(pin) ? 'text-amber' : 'text-muted'}>Set</Text>
        </Pressable>
        {profile.pinHash && (
          <Pressable
            onPress={() => {
              setPin(db, profile.id, null, Date.now());
              refresh();
            }}
          >
            <Text className="text-danger">Remove PIN</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-3 pt-2">
        <View className="flex-1">
          <Text className="text-paper">Kids profile</Text>
          <Text className="text-sm text-muted">Can’t add or remove add-ons.</Text>
        </View>
        <Switch value={profile.kids} onValueChange={(kids) => save({ kids })} />
      </View>

      <Text className="pt-2 text-xs uppercase tracking-wider text-muted">
        Catalogs this profile sees
      </Text>
      {addons.map((a) => (
        <View key={a.url} className="flex-row items-center gap-3 border-b border-line py-2">
          <Text className="flex-1 text-paper">{a.manifest.name}</Text>
          <Switch
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

      <Pressable onPress={remove} className="pt-4">
        <Text className="text-danger">Delete this profile</Text>
      </Pressable>
    </ScrollView>
  );
}
