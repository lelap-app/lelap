import { readSettings, type Settings } from '@lelap/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sourceManifest } from '../src/addonSources';
import { COLORS, IconButton } from '../src/components/Icon';
import { TextButton } from '../src/components/TextButton';
import { hint } from '../src/a11y';
import { t } from '../src/i18n';
import { activeProfile } from '../src/profile';
import { scrobblerForm, scrobblersWork, setUpScrobbler } from '../src/scrobblers';
import { READABLE } from '../src/layout';

/**
 * `/scrobbler?url=…`: sets up a scrobbler inside the app (M61), such as the Open Library reading
 * log, with the form its manifest describes. The values are checked by the add-on, then kept
 * sealed on this device.
 */
export default function ScrobblerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ url?: string }>();
  const url = typeof params.url === 'string' ? params.url : '';
  const [manifest] = useState(() => (url ? sourceManifest(url) : null));
  const [form] = useState(() => (url ? scrobblerForm(url) : { values: {}, again: false }));
  const [values, setValues] = useState<Settings>(form.values);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fields = manifest?.settings ?? [];

  const save = async () => {
    const read = readSettings(fields, values);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setUpScrobbler(url, read.settings);
      void queryClient.invalidateQueries();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-night"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        ...READABLE,
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 24,
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
      {!manifest || activeProfile()?.kids ? (
        <>
          <Text className="text-paper">
            {manifest
              ? t('Ask a grown-up to change add-ons.')
              : t('This add-on is not on this device.')}
          </Text>
          <TextButton text={t('Back')} onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
            {manifest.name}
          </Text>
          <Text className="text-sm text-soft">{manifest.description}</Text>
          {!scrobblersWork ? (
            <Text className="text-sm text-muted">
              {t(
                'This works in the Android app only: it signs in with a cookie, which a browser keeps from the page.',
              )}
            </Text>
          ) : (
            <>
              {form.again && (
                <Text className="text-sm text-amber">
                  {t('Enter the keys again: this device can’t open the ones saved before.')}
                </Text>
              )}
              {fields.map((field) => (
                <View key={field.key} className="gap-1">
                  <Text className="text-sm text-soft">{field.label}</Text>
                  <TextInput
                    value={values[field.key] ?? ''}
                    onChangeText={(v) => setValues((current) => ({ ...current, [field.key]: v }))}
                    accessibilityLabel={field.label}
                    {...hint(field.help)}
                    {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
                    placeholderTextColor={COLORS.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={field.type === 'password'}
                    className="min-h-12 rounded-lg border border-line px-3 py-2 text-paper"
                  />
                  {field.help && <Text className="text-xs text-muted">{field.help}</Text>}
                </View>
              ))}
              <Text className="text-xs text-muted">
                {t(
                  'Runs on this device, in a sandbox. It can reach only {hosts}, and what you enter stays sealed on this device.',
                  { hosts: (manifest.sandbox?.hosts ?? []).join(', ') },
                )}
              </Text>
              {error && (
                <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
                  {error}
                </Text>
              )}
              <Pressable
                disabled={saving}
                onPress={() => void save()}
                accessibilityRole="button"
                accessibilityLabel={t('Check and save')}
                className="min-h-12 items-center justify-center self-start rounded-full bg-amber px-5 py-3 active:opacity-80"
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.ink} />
                ) : (
                  <Text className="font-semibold text-ink">{t('Check and save')}</Text>
                )}
              </Pressable>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
