import { parseCodeList } from '@lelap/core';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { hint as hintProps } from '../../src/a11y';
import { Toggle } from '../../src/components/TextButton';
import { t } from '../../src/i18n';
import { Row, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';
import { useColors } from '../../src/theme';

/**
 * Settings → Streams (M153): how a book's page orders the streams of every add-on. Three
 * settings on purpose, per profile and synced; no rules editor.
 */
export default function StreamSettings() {
  const { settings, update } = useSettingsState();
  return (
    <SettingsPage title={t('Streams')}>
      <Text className="text-sm leading-5 text-soft">
        {t(
          'A book’s page lists streams in a language you prefer first, then in a format you prefer, then in your add-ons’ order. Copies of the same recording from several add-ons show as one.',
        )}
      </Text>
      <CodeField
        label={t('Preferred formats')}
        hint={t('Most wanted first, such as m4b, mp3. Empty: no preference.')}
        value={settings.streamFormats}
        onSave={(list) => update('streamFormats', list)}
        kind="format"
      />
      <CodeField
        label={t('Preferred languages')}
        hint={t(
          'Language codes, most wanted first, such as en, ms. Empty: this profile’s language.',
        )}
        value={settings.streamLanguages ?? []}
        onSave={(list) => update('streamLanguages', list.length > 0 ? list : null)}
        kind="language"
      />
      <Row
        label={t('Show streams that are still preparing')}
        detail={t('A source may need minutes or hours before such a stream plays.')}
      >
        <Toggle
          value={settings.showPreparingStreams}
          onValueChange={(v) => update('showPreparingStreams', v)}
        />
      </Row>
    </SettingsPage>
  );
}

/** A list of codes typed with commas; saved, tidied, when the field is left. */
function CodeField({
  label,
  hint,
  value,
  onSave,
  kind,
}: {
  label: string;
  hint: string;
  value: string[];
  onSave: (list: string[]) => void;
  kind: 'format' | 'language';
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null) return;
    onSave(parseCodeList(draft, kind));
    setDraft(null);
  };
  // Leaving the page with the keyboard open never blurs the field on Android: save then too.
  const pending = useRef({ draft, onSave });
  pending.current = { draft, onSave };
  useEffect(
    () => () => {
      const { draft: left, onSave: keep } = pending.current;
      if (left !== null) keep(parseCodeList(left, kind));
    },
    [kind],
  );
  return (
    <View className="gap-1 border-b border-line py-4">
      <Text className="text-base text-paper">{label}</Text>
      <TextInput
        value={draft ?? value.join(', ')}
        onChangeText={setDraft}
        onBlur={save}
        onSubmitEditing={save}
        accessibilityLabel={label}
        {...hintProps(hint)}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        className="min-h-12 rounded-lg border border-line px-3 py-2 text-paper"
      />
      <Text className="text-xs text-muted">{hint}</Text>
    </View>
  );
}
