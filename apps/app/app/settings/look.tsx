import { ACCENT_IDS, type Settings, type ThemeChoice } from '@lelap/core';
import { Text, View } from 'react-native';

import { showAlert } from '../../src/dialog';
import { TextButton, Toggle } from '../../src/components/TextButton';
import { LANGUAGES, t } from '../../src/i18n';
import { useInstall } from '../../src/installed';
import { Choice, Row, SectionHeader, SettingsPage } from '../../src/settings/rows';
import { type UpdateSetting, useSettingsState } from '../../src/settings/state';
import { SHORTCUTS_SUPPORTED, showShortcuts } from '../../src/shortcuts';
import {
  accentLabel,
  accentSwatch,
  exportTheme,
  pickThemeFile,
  themeLabel,
  useTheme,
} from '../../src/theme';

const THEME_CHOICES: ThemeChoice[] = ['night', 'dusk', 'day', 'sepia', 'contrast', 'system'];

/** Settings → Look and language: language, theme, accent and theme files, badges, the web's extras. */
export default function LookSettings() {
  const install = useInstall();
  const { settings, update } = useSettingsState();
  return (
    <SettingsPage title={t('Look and language')}>
      <SectionHeader
        text={t('Language')}
        about={{
          label: t('About the language'),
          onPress: () =>
            showAlert(
              t('Language'),
              t(
                'This changes Lelap’s own buttons, menus and messages. Titles, descriptions, covers and audio come from add-ons and your files, and stay as they are.',
              ),
            ),
        }}
      />
      <View className="gap-3 border-b border-line py-4">
        <Text className="text-detail text-muted">{t('For this profile only.')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <Choice
              key={l.code}
              label={l.name}
              active={settings.language === l.code}
              onPress={() => update('language', l.code)}
            />
          ))}
        </View>
      </View>

      <SectionHeader text={t('Theme')} />
      <LookRows settings={settings} update={update} />

      <SectionHeader text={t('Covers')} />
      <Row
        label={t('Badges on covers')}
        detail={t(
          'A rating and new episodes from add-ons, and what you finished or started, drawn on covers.',
        )}
      >
        <Toggle
          value={settings.badgesOnCovers}
          onValueChange={(v) => update('badgesOnCovers', v)}
        />
      </Row>

      {(SHORTCUTS_SUPPORTED || install) && <SectionHeader text={t('In the browser')} />}
      {SHORTCUTS_SUPPORTED && (
        <Row
          label={t('Keyboard shortcuts')}
          detail={t(
            'Play, skip, chapters, bookmarks, speed and the tabs from the keyboard. Press ? anywhere.',
          )}
        >
          <TextButton text={t('Show')} onPress={showShortcuts} />
        </Row>
      )}

      {install && (
        <Row
          label={t('Install Lelap')}
          detail={t(
            'Lelap gets its own window and icon, opens without the browser and starts without a connection.',
          )}
        >
          <TextButton text={t('Install')} onPress={() => void install()} />
        </Row>
      )}
    </SettingsPage>
  );
}

/** Theme, accent, and themes as files (M108); for this profile, like the language. */
function LookRows({ settings, update }: { settings: Settings; update: UpdateSetting }) {
  const theme = useTheme();
  const choices: ThemeChoice[] =
    settings.customTheme === null ? THEME_CHOICES : [...THEME_CHOICES, 'custom'];
  const openFile = async () => {
    const custom = await pickThemeFile();
    if (!custom) return;
    update('customTheme', custom);
    update('theme', 'custom');
  };
  return (
    <>
      <View className="gap-3 border-b border-line py-4">
        <View className="flex-row flex-wrap gap-2">
          {choices.map((choice) => (
            <Choice
              key={choice}
              label={themeLabel(choice, settings.customTheme)}
              active={settings.theme === choice}
              onPress={() => update('theme', choice)}
            />
          ))}
        </View>
        <Text className="text-detail text-muted">
          {theme.highContrast
            ? t('Text at 7:1 or more, stronger borders, wider focus rings and no text over covers.')
            : settings.theme === 'system'
              ? t('Day when the phone is light, Night when it is dark.')
              : t('For this profile only. Car mode stays light by day and dark at night.')}
        </Text>
        <Text className="pt-2 text-body text-paper">{t('Accent')}</Text>
        {settings.theme === 'custom' ? (
          <Text className="text-detail text-muted">
            {t('A theme from a file brings its own accent, in car mode too.')}
          </Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {ACCENT_IDS.map((accent) => (
              <Choice
                key={accent}
                label={accentLabel(accent)}
                swatch={accentSwatch(theme, accent)}
                active={settings.accent === accent}
                onPress={() => update('accent', accent)}
              />
            ))}
          </View>
        )}
      </View>
      <Row
        label={t('Save this look as a file')}
        detail={t('A theme file holds only a name and colours, so you can share a look.')}
      >
        <TextButton text={t('Save')} onPress={() => void exportTheme()} />
      </Row>
      <Row label={t('Use a theme file')}>
        <TextButton text={t('Choose')} onPress={() => void openFile()} />
      </Row>
    </>
  );
}
