import { createProfile, getSettings, listProfiles, setSetting } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { COLORS, IconButton } from '../src/components/Icon';
import { useAllAddons } from '../src/addons';
import { Avatar, pickAvatar } from '../src/components/Avatar';
import { db, newId } from '../src/db';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';

/** Everyone who listens on this device (and, with sync, the household). */
export default function ProfilesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const allAddons = useAllAddons();
  // `version` is the signal to re-read the database.
  const profiles = useMemo(() => listProfiles(db), [version]);
  const [name, setName] = useState('');
  const [kids, setKids] = useState(false);

  const add = () => {
    if (name.trim() === '') return;
    const id = createProfile(
      db,
      {
        name,
        avatar: pickAvatar(profiles.map((p) => p.avatar)),
        kids,
        // A kids profile starts with only the app's own add-ons; a grown-up can allow more.
        hiddenAddons: kids ? allAddons.filter((a) => !a.builtin).map((a) => a.url) : [],
      },
      Date.now(),
      newId,
    );
    // Starts in the language of whoever made it; it can change its own later.
    setSetting(db, id, 'language', getSettings(db, profileId).language, Date.now());
    setName('');
    setKids(false);
    refresh();
    router.push({ pathname: '/profile', params: { id } });
  };

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
        <IconButton
          name="back"
          label={t('Back')}
          color={COLORS.soft}
          onPress={() => router.back()}
        />
      </View>
      <Text className="text-3xl font-semibold text-paper">{t('Profiles')}</Text>
      <Text className="text-soft">
        {t(
          'Each profile has its own places, library, Up Next, podcasts and settings. Downloads are shared. With more than one, Lelap asks who’s listening when it opens.',
        )}
      </Text>

      {profiles.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => router.push({ pathname: '/profile', params: { id: p.id } })}
          className="flex-row items-center gap-3 rounded-xl border border-line p-3 active:bg-raised"
        >
          <Avatar avatar={p.avatar} name={p.name} size={48} />
          <View className="flex-1">
            <Text className="text-base text-paper">{p.name}</Text>
            <Text className="text-sm text-muted">
              {[
                p.id === profileId ? t('Listening now') : null,
                p.kids ? t('Kids') : null,
                p.pinHash ? 'PIN' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text className="text-amber">{t('Edit')}</Text>
        </Pressable>
      ))}

      <View className="gap-3 rounded-xl border border-line p-3">
        <Text className="text-paper">{t('Add a profile')}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('Name')}
          placeholderTextColor="#8d8a83"
          onSubmitEditing={add}
          className="rounded-lg border border-line px-3 py-2 text-paper"
        />
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="text-paper">{t('Kids profile')}</Text>
            <Text className="text-sm text-muted">
              {t('Can’t change add-ons; sees the catalogs you allow.')}
            </Text>
          </View>
          <Switch value={kids} onValueChange={setKids} />
        </View>
        <Pressable disabled={name.trim() === ''} onPress={add}>
          <Text className={name.trim() === '' ? 'text-muted' : 'text-amber'}>{t('Add')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
