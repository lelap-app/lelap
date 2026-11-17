import {
  addonBase,
  fetchManifest,
  installAddon,
  type InstalledAddon,
  normalizeManifestUrl,
  removeAddon,
} from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '../src/dialog';
import { COLORS, IconButton } from '../src/components/Icon';
import { fetcher, useAddons } from '../src/addons';
import { db, newId } from '../src/db';
import { useLibrary } from '../src/player';
import { activeProfile } from '../src/profile';

function AddonRow({ addon, onRemove }: { addon: InstalledAddon; onRemove: () => void }) {
  return (
    <View className="gap-1 border-b border-line py-4">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-base text-paper">
          {addon.manifest.name}
          <Text className="text-sm text-muted"> {addon.manifest.version}</Text>
        </Text>
        {addon.manifest.configurable && (
          <Pressable onPress={() => void Linking.openURL(`${addonBase(addon.url)}configure`)}>
            <Text className="text-amber">Configure</Text>
          </Pressable>
        )}
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text className="text-danger">Remove</Text>
        </Pressable>
      </View>
      {addon.manifest.description !== '' && (
        <Text className="text-sm text-soft">{addon.manifest.description}</Text>
      )}
      <Text numberOfLines={1} className="text-xs text-muted">
        {addon.url}
      </Text>
    </View>
  );
}

/** A kids profile can't change add-ons; a grown-up does it from their own profile. */
export default function AddonsScreen() {
  const router = useRouter();
  if (activeProfile()?.kids) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-night p-8">
        <Text className="text-center text-paper">Ask a grown-up to change add-ons.</Text>
        <Pressable onPress={() => router.back()}>
          <Text className="text-amber">Back</Text>
        </Pressable>
      </View>
    );
  }
  return <AddonsManager />;
}

function AddonsManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  const queryClient = useQueryClient();
  const addons = useAddons();
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  const changed = () => {
    refresh();
    void queryClient.invalidateQueries();
  };

  const add = async () => {
    const manifestUrl = normalizeManifestUrl(url);
    if (!manifestUrl) {
      showAlert('Not a web address', 'Paste the add-on’s manifest URL.');
      return;
    }
    setAdding(true);
    try {
      const manifest = await fetchManifest(fetcher, manifestUrl);
      showAlert(
        `Add ${manifest.name}?`,
        `${manifest.description}\n\nAdd-ons are run by their authors, not by Lelap. Only add ones you trust.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add',
            onPress: () => {
              installAddon(db, { url: manifestUrl, manifest, now: Date.now(), newId });
              setUrl('');
              changed();
            },
          },
        ],
      );
    } catch (error) {
      showAlert('Cannot add', error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const remove = (addon: InstalledAddon) =>
    showAlert(
      `Remove ${addon.manifest.name}?`,
      'Books you already play from it stay in your library.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeAddon(db, addon.url, Date.now());
            changed();
          },
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
        paddingBottom: 24,
      }}
    >
      <View className="-ml-2 self-start">
        <IconButton name="back" label="Back" color={COLORS.soft} onPress={() => router.back()} />
      </View>
      <Text className="pb-2 text-3xl font-semibold text-paper">Add-ons</Text>
      <Text className="pb-4 text-sm text-muted">
        Add-ons bring catalogs and audio. Audio always streams straight from the add-on’s source.
      </Text>

      {addons.map((addon) => (
        <AddonRow key={addon.url} addon={addon} onRemove={() => remove(addon)} />
      ))}
      {addons.length === 0 && <Text className="py-4 text-muted">No add-ons installed.</Text>}

      <Text className="pt-6 text-xs uppercase tracking-wider text-muted">Add an add-on</Text>
      <View className="flex-row items-center gap-3 pt-2">
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://…/manifest.json"
          placeholderTextColor="#8d8a83"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={() => void add()}
          className="flex-1 rounded-lg bg-raised px-4 py-3 text-base text-paper"
        />
        <Pressable
          disabled={adding || url.trim() === ''}
          onPress={() => void add()}
          className="rounded-full bg-amber px-4 py-3 active:opacity-80"
        >
          {adding ? (
            <ActivityIndicator color="#1a1305" />
          ) : (
            <Text className="font-semibold text-ink">Add</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}
