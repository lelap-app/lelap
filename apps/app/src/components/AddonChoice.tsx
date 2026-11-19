import {
  type ChoiceOption,
  choiceOptions,
  choiceValues,
  type Manifest,
  offersSettingOptions,
  type SettingField,
  type Settings,
  SettingsOptions,
} from '@lelap/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { said } from './AddonSignin';
import { Icon } from './Icon';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

// A `choice` setting (revision 11), such as Plex's libraries: a list to pick from instead of names
// to type. Its options are the manifest's own, or those the add-on's `settings` resource lists for
// the form so far, asked after a sign-in, when a saved setup form opens and on “Load the list”.

type Loaded = { options: SettingsOptions['options']; loading: boolean; error: string | null };

/**
 * The options of a form's choice fields, and `load` to ask the add-on for them again with the
 * given values. `ask` calls the add-on's `settings` resource in its sandbox; `initial`, when
 * given, is a saved form to ask with at once.
 */
export function useChoiceOptions(
  manifest: Manifest | null,
  initial: Settings | null,
  ask: (settings: Settings) => Promise<{ status: number; body: unknown }>,
) {
  const asks = manifest !== null && offersSettingOptions(manifest);
  const [loaded, setLoaded] = useState<Loaded>({ options: {}, loading: false, error: null });
  const askRef = useRef(ask);
  askRef.current = ask;
  // Only the latest load counts: an earlier one may answer after it.
  const seq = useRef(0);

  // Another add-on chosen: nothing of the last one's list, or a load still running, carries over.
  useEffect(() => {
    seq.current++;
    setLoaded({ options: {}, loading: false, error: null });
  }, [manifest]);

  const load = useCallback(
    async (settings: Settings) => {
      if (!asks) return;
      const mine = ++seq.current;
      setLoaded((current) => ({ ...current, loading: true, error: null }));
      try {
        const { status, body } = await askRef.current(settings);
        if (status !== 200) throw new Error(said(body, status));
        const parsed = SettingsOptions.safeParse(body);
        if (!parsed.success) throw new Error(t('The add-on’s list is not valid.'));
        if (mine === seq.current) {
          setLoaded({ options: parsed.data.options, loading: false, error: null });
        }
      } catch (error) {
        if (mine === seq.current) {
          setLoaded((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    },
    [asks, manifest],
  );

  // A saved form, such as a scrobbler set up before, shows its list at once.
  const [opened] = useState(initial);
  useEffect(() => {
    if (opened && Object.values(opened).some((v) => v !== '')) void load(opened);
  }, [load, opened]);

  const fields = manifest?.settings ?? [];
  return {
    asks,
    options: choiceOptions(fields, loaded.options),
    loading: loaded.loading,
    error: loaded.error,
    load,
  };
}

/** One choice field: its options as rows to tick, or to pick one of. */
export function AddonChoice({
  field,
  options,
  value,
  onChange,
  locked = false,
  loading = false,
  error = null,
  onLoad,
}: {
  field: SettingField;
  options: ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
  /** Shown but not changed: the server's place when only the login is entered again. */
  locked?: boolean;
  loading?: boolean;
  error?: string | null;
  /** Asks the add-on for the list again; absent when the options are fixed. */
  onLoad?: () => void;
}) {
  const colors = useColors();
  const picked = choiceValues(value);
  const several = field.multiple === true;
  // A value no longer in the list stays, so the listener sees it and can take it off.
  const shown = [
    ...options,
    ...picked
      .filter((v) => !options.some((o) => o.value === v))
      .map((v): ChoiceOption =>
        options.length > 0
          ? { value: v, label: v, detail: t('Not in the list') }
          : { value: v, label: v },
      ),
  ];

  const toggle = (option: string) => {
    const on = picked.includes(option);
    if (several) {
      onChange((on ? picked.filter((v) => v !== option) : [...picked, option]).join('\n'));
    } else {
      // Picking the chosen one again clears it, unless one is needed.
      onChange(on ? (field.required ? option : '') : option);
    }
  };

  return (
    <View className="gap-2">
      <Text className="text-sm text-soft">{field.label}</Text>
      <View
        accessibilityRole={several ? 'list' : 'radiogroup'}
        accessibilityLabel={field.label}
        className="gap-2"
      >
        {shown.map((option) => {
          const on = picked.includes(option.value);
          return (
            <Pressable
              key={option.value}
              disabled={locked}
              onPress={() => toggle(option.value)}
              accessibilityRole={several ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: on, disabled: locked }}
              aria-checked={on}
              className={`min-h-12 flex-row items-center gap-3 rounded-xl border px-3 py-2 ${on ? 'border-amber bg-raised' : 'border-line'}`}
            >
              {on ? (
                <Icon name="check" size={24} color={locked ? colors.muted : colors.amber} />
              ) : (
                <View
                  className={`m-[3px] h-[18px] w-[18px] border-2 border-line ${several ? 'rounded' : 'rounded-full'}`}
                />
              )}
              <View className="flex-1">
                <Text className={on && !locked ? 'text-paper' : 'text-soft'}>{option.label}</Text>
                {option.detail && <Text className="text-xs text-muted">{option.detail}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      {loading ? (
        <View className="min-h-12 flex-row items-center gap-2">
          <ActivityIndicator size="small" color={colors.muted} />
          <Text className="text-xs text-muted">{t('Loading the list…')}</Text>
        </View>
      ) : (
        onLoad &&
        !locked && (
          <TextButton
            className="self-start"
            text={shown.length > 0 ? t('Load the list again') : t('Load the list')}
            onPress={onLoad}
          />
        )
      )}
      {error && (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
          {error}
        </Text>
      )}
      {field.help && <Text className="text-xs text-muted">{field.help}</Text>}
    </View>
  );
}
