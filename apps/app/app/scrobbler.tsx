import { addonBase } from '@lelap/core';
import { readSettings, type Settings } from '@lelap/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sourceManifest } from '../src/addonSources';
import { AddonChoice, useChoiceOptions } from '../src/components/AddonChoice';
import { Button } from '../src/components/Button';
import { LoadState } from '../src/components/LoadState';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TextField } from '../src/components/TextField';
import { hint } from '../src/a11y';
import { t } from '../src/i18n';
import { activeProfile } from '../src/profile';
import { addonAnswers } from '../src/addons';
import { scrobblerForm, scrobblersWork, settingOptions, setUpScrobbler } from '../src/scrobblers';
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
  const kids = activeProfile()?.kids === true;
  const choices = useChoiceOptions(
    scrobblersWork ? manifest : null,
    form.again ? null : form.values,
    (settings) =>
      manifest
        ? settingOptions(url, manifest, settings)
        : Promise.resolve({ status: 404, body: null }),
  );

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
      // Answers given with the old settings go too, however long the add-on said to keep them.
      addonAnswers.forget(addonBase(url));
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
      <ScreenHeader
        inGap
        title={manifest && !kids ? manifest.name : undefined}
        subtitle={manifest && !kids ? manifest.description : undefined}
      />
      <LoadState
        loading={false}
        failed={
          (!manifest || kids) && {
            title: manifest
              ? t('Ask a grown-up to change add-ons.')
              : t('This add-on is not on this device.'),
          }
        }
      >
        {manifest && !kids && (
          <>
            {!scrobblersWork ? (
              <Text className="text-detail text-muted">
                {t(
                  'This works in the Android app only: it signs in with a cookie, which a browser keeps from the page.',
                )}
              </Text>
            ) : (
              <>
                {form.again && (
                  <Text className="text-detail text-amber">
                    {t('Enter the keys again: this device can’t open the ones saved before.')}
                  </Text>
                )}
                {fields.map((field) =>
                  field.type === 'choice' ? (
                    <AddonChoice
                      key={field.key}
                      field={field}
                      options={choices.options[field.key] ?? []}
                      value={values[field.key] ?? ''}
                      onChange={(v) => setValues((current) => ({ ...current, [field.key]: v }))}
                      loading={choices.loading}
                      error={choices.error}
                      {...(choices.asks && field.options === undefined
                        ? { onLoad: () => void choices.load(values) }
                        : {})}
                    />
                  ) : (
                    <View key={field.key} className="gap-1">
                      <Text className="text-detail text-soft">{field.label}</Text>
                      <TextField
                        value={values[field.key] ?? ''}
                        onChangeText={(v) =>
                          setValues((current) => ({ ...current, [field.key]: v }))
                        }
                        accessibilityLabel={field.label}
                        {...hint(field.help)}
                        {...(field.placeholder === undefined
                          ? {}
                          : { placeholder: field.placeholder })}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry={field.type === 'password'}
                      />
                      {field.help && <Text className="text-caption text-muted">{field.help}</Text>}
                    </View>
                  ),
                )}
                <Text className="text-caption text-muted">
                  {t(
                    'Runs on this device, in a sandbox. It can reach only {hosts}, and what you enter stays sealed on this device.',
                    { hosts: (manifest.sandbox?.hosts ?? []).join(', ') },
                  )}
                </Text>
                {error && (
                  <Text accessibilityLiveRegion="assertive" className="text-detail text-danger">
                    {error}
                  </Text>
                )}
                <Button
                  text={t('Check and save')}
                  onPress={() => void save()}
                  busy={saving}
                  className="self-start"
                />
              </>
            )}
          </>
        )}
      </LoadState>
    </ScrollView>
  );
}
