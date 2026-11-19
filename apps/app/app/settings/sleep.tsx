import { Platform, Text, View } from 'react-native';

import { Toggle } from '../../src/components/TextButton';
import { t } from '../../src/i18n';
import { Choice, Row, SettingsPage, TimeStepper } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';

const BEDTIME_MINUTES = [15, 30, 45, 60];
// Percent of the normal volume while the bedtime timer runs.
const BEDTIME_VOLUMES = [100, 80, 60, 40];

/** Settings → Sleep: the sleep timer at bedtime and shaking for more time (Android). */
export default function SleepSettings() {
  const { settings, update } = useSettingsState();
  return (
    <SettingsPage title={t('Sleep')}>
      {/* Settings hides this page's line on the web; an address typed by hand still lands here. */}
      {Platform.OS !== 'android' && (
        <Text className="text-sm text-muted">
          {t('The sleep timer at bedtime and shaking for more time are in the Android app.')}
        </Text>
      )}
      {Platform.OS === 'android' && (
        <View className="gap-3 border-b border-line py-4">
          <View className="flex-row items-center gap-4">
            <View className="flex-1 gap-1">
              <Text className="text-base text-paper">{t('Start a sleep timer at bedtime')}</Text>
              <Text className="text-sm text-muted">
                {t(
                  'Once a night: when this window opens while you listen, or when you press Play in it. Works with the app closed.',
                )}
              </Text>
            </View>
            <Toggle
              accessibilityLabel={t('Start a sleep timer at bedtime')}
              value={settings.bedtimeTimer}
              onValueChange={(v) => update('bedtimeTimer', v)}
            />
          </View>
          {settings.bedtimeTimer && (
            <>
              <TimeStepper
                label={t('From')}
                minutes={settings.bedtimeStart}
                onChange={(m) => update('bedtimeStart', m)}
              />
              <TimeStepper
                label={t('To')}
                minutes={settings.bedtimeEnd}
                onChange={(m) => update('bedtimeEnd', m)}
              />
              <View className="flex-row flex-wrap gap-2">
                {BEDTIME_MINUTES.map((m) => (
                  <Choice
                    key={m}
                    label={t('{n} min', { n: m })}
                    active={!settings.bedtimeChapter && settings.bedtimeMinutes === m}
                    onPress={() => {
                      update('bedtimeChapter', false);
                      update('bedtimeMinutes', m);
                    }}
                  />
                ))}
                <Choice
                  label={t('End of chapter')}
                  active={settings.bedtimeChapter}
                  onPress={() => update('bedtimeChapter', true)}
                />
              </View>
              <Text className="text-sm text-muted">{t('Volume until the timer ends')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {BEDTIME_VOLUMES.map((v) => (
                  <Choice
                    key={v}
                    label={v === 100 ? t('As it is') : `${v}%`}
                    active={settings.bedtimeVolume === v}
                    onPress={() => update('bedtimeVolume', v)}
                  />
                ))}
              </View>
            </>
          )}
        </View>
      )}
      {Platform.OS === 'android' && (
        <Row
          label={t('Shake for more time')}
          detail={t('In the last five minutes of a sleep timer, shake the phone for ten more.')}
        >
          <Toggle
            value={settings.shakeToExtend}
            onValueChange={(v) => update('shakeToExtend', v)}
          />
        </Row>
      )}
    </SettingsPage>
  );
}
