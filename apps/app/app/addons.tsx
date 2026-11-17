import {
  type AddonHealth,
  healthState,
  type HealthState,
  type InstalledAddon,
  normalizeManifestUrl,
  parseAddonLink,
  removeAddon,
} from '@lelap/core';
import {
  isConfigurable,
  LATEST_PROTOCOL_VERSION,
  needsConfiguration,
  protocolVersionOf,
} from '@lelap/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { reviewAddon } from '../src/addonReview';
import { installAddonFile, isAddonFile } from '../src/localAddons';
import { ActionSheet, type Action } from '../src/components/ActionSheet';
import { COLORS, IconButton } from '../src/components/Icon';
import { showAlert } from '../src/dialog';
import { checkAddonHealth, useAddonHealth, useAddons } from '../src/addons';
import { confirmAddon, openConfigure } from '../src/addonInstall';
import { db } from '../src/db';
import { useLibrary } from '../src/player';
import { activeProfile } from '../src/profile';

const STATE_COLOR: Record<HealthState, string> = {
  unknown: COLORS.muted,
  ok: COLORS.ok,
  slow: COLORS.amber,
  degraded: COLORS.amber,
  failing: COLORS.danger,
};

const stateLabel = (): Record<HealthState, string> => ({
  unknown: t('Not asked yet'),
  ok: t('Working'),
  slow: t('Slow'),
  degraded: t('Partly working'),
  failing: t('Not working'),
});

function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 24 ? t('{n} h ago', { n: hours }) : t('{n} d ago', { n: Math.round(hours / 24) });
}

/** One or two lines on how the add-on answered this session. */
function healthLines(health: AddonHealth, now: number): string[] {
  const lines: string[] = [];
  if (health.reported?.message) lines.push(health.reported.message);
  if (health.lastOkAt !== null && health.lastLatencyMs !== null)
    lines.push(
      t('Answered in {ms} ms, {when}', {
        ms: health.lastLatencyMs,
        when: ago(health.lastOkAt, now),
      }),
    );
  if (health.lastError && (health.lastOkAt === null || health.lastError.at > health.lastOkAt))
    lines.push(`${health.lastError.message}, ${ago(health.lastError.at, now)}`);
  return lines;
}

function AddonRow({ addon, onMore }: { addon: InstalledAddon; onMore: () => void }) {
  const health = useAddonHealth(addon.url);
  const state = healthState(health);
  const newer = protocolVersionOf(addon.manifest) > LATEST_PROTOCOL_VERSION;
  return (
    <View className="gap-1 border-b border-line py-4">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-base text-paper">
          {addon.manifest.name}
          <Text className="text-sm text-muted"> {addon.manifest.version}</Text>
        </Text>
        {isConfigurable(addon.manifest) && (
          <Pressable
            onPress={() => openConfigure(addon.url)}
            accessibilityRole="button"
            className="rounded-full border border-line px-3 py-1.5 active:bg-raised"
          >
            <Text className="text-sm text-amber">{t('Configure')}</Text>
          </Pressable>
        )}
        <IconButton
          name="more"
          label={t('More for {name}', { name: addon.manifest.name })}
          color={COLORS.soft}
          onPress={onMore}
        />
      </View>
      {addon.manifest.description !== '' && (
        <Text className="text-sm text-soft">{addon.manifest.description}</Text>
      )}
      <View className="flex-row items-center gap-2 pt-1">
        <View style={{ backgroundColor: STATE_COLOR[state] }} className="h-2 w-2 rounded-full" />
        <Text className="text-xs text-soft">{stateLabel()[state]}</Text>
      </View>
      {healthLines(health, Date.now()).map((line) => (
        <Text key={line} className="text-xs text-muted">
          {line}
        </Text>
      ))}
      {needsConfiguration(addon.manifest) && (
        <Text className="text-xs text-amber">{t('Needs settings before it can be used.')}</Text>
      )}
      {newer && (
        <Text className="text-xs text-muted">
          {t('Made for a newer Lelap; update the app to use all of it.')}
        </Text>
      )}
      <Text numberOfLines={1} className="text-xs text-muted">
        {addon.url.replace(/\/(e1|p1)\.[A-Za-z0-9_-]+\//, '/…/')}
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
        <Text className="text-center text-paper">{t('Ask a grown-up to change add-ons.')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text className="text-amber">{t('Back')}</Text>
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

  const [menu, setMenu] = useState<InstalledAddon | null>(null);

  // Real requests fill in most of the health; `/health` adds what the add-on says about itself.
  useEffect(() => {
    void checkAddonHealth(addons);
    // Once per visit, not on every library change.
  }, []);

  const add = async () => {
    // A link from a configure page works here too, for the web app or a copied link.
    if (isAddonFile(url)) {
      setAdding(true);
      try {
        if (await installAddonFile(url.trim())) {
          setUrl('');
          changed();
        }
      } catch (error) {
        showAlert(t('Cannot add'), error instanceof Error ? error.message : String(error));
      } finally {
        setAdding(false);
      }
      return;
    }
    const manifestUrl = parseAddonLink(url) ?? normalizeManifestUrl(url);
    if (!manifestUrl) {
      showAlert(t('Not a web address'), t('Paste the add-on’s manifest URL.'));
      return;
    }
    setAdding(true);
    try {
      if ((await confirmAddon(manifestUrl)) === 'added') {
        setUrl('');
        changed();
      }
    } catch (error) {
      showAlert(t('Cannot add'), error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const remove = (addon: InstalledAddon) =>
    showAlert(
      t('Remove {name}?', { name: addon.manifest.name }),
      t('Books you already play from it stay in your library.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Remove'),
          style: 'destructive',
          onPress: () => {
            removeAddon(db, addon.url, Date.now());
            changed();
          },
        },
      ],
    );

  const actions = (addon: InstalledAddon): Action[] => [
    {
      icon: 'discover',
      label: t('What it can do'),
      onPress: () => void reviewAddon(addon.manifest, addon.url, null),
    },
    ...(isConfigurable(addon.manifest)
      ? [
          {
            icon: 'settings' as const,
            label: t('Configure'),
            onPress: () => openConfigure(addon.url),
          },
        ]
      : []),
    {
      icon: 'check',
      label: t('Check now'),
      onPress: () => void checkAddonHealth([addon]),
    },
    { icon: 'close', label: t('Remove'), danger: true, onPress: () => remove(addon) },
  ];

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
        <IconButton
          name="back"
          label={t('Back')}
          color={COLORS.soft}
          onPress={() => router.back()}
        />
      </View>
      <Text className="pb-2 text-3xl font-semibold text-paper">{t('Add-ons')}</Text>
      <Text className="pb-4 text-sm text-muted">
        {t(
          'Add-ons bring catalogs and audio. Audio always streams straight from the add-on’s source.',
        )}
      </Text>

      {addons.map((addon) => (
        <AddonRow key={addon.url} addon={addon} onMore={() => setMenu(addon)} />
      ))}
      {addons.length === 0 && <Text className="py-4 text-muted">{t('No add-ons installed.')}</Text>}

      <Text className="pt-6 text-xs uppercase tracking-wider text-muted">{t('Add an add-on')}</Text>
      <View className="flex-row items-center gap-3 pt-2">
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder={'https://…/manifest.json'}
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
            <Text className="font-semibold text-ink">{t('Add')}</Text>
          )}
        </Pressable>
      </View>
      <Text className="pt-3 text-xs text-muted">
        {t('Health shows how each add-on answered since Lelap started. It stays on this device.')}
      </Text>
      <ActionSheet
        title={menu?.manifest.name ?? null}
        actions={menu ? actions(menu) : []}
        onClose={() => setMenu(null)}
      />
    </ScrollView>
  );
}
