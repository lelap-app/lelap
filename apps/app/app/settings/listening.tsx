import { DUCK_PERCENT } from '@lelap/core';
import { Platform, Text, View } from 'react-native';

import { LevelSlider } from '../../src/components/LevelSlider';
import { Pill } from '../../src/components/Pill';
import { soundOptions, SoundRow } from '../../src/components/SoundSheet';
import { Toggle } from '../../src/components/TextButton';
import { t } from '../../src/i18n';
import { Choice, Row, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';

const SKIP_SECONDS = [10, 15, 30, 45, 60];

/** Settings → Listening: skips, smart rewind, the sound for everything and calls. */
export default function ListeningSettings() {
  const { settings, update } = useSettingsState();
  return (
    <SettingsPage title={t('Listening')}>
      <View className="gap-3 border-b border-line py-4">
        <Text className="text-base text-paper">{t('Skip interval')}</Text>
        <Text className="text-sm text-muted">
          {t('For the skip buttons, the lock screen and headphones.')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SKIP_SECONDS.map((s) => {
            const active = settings.skipIntervalMs === s * 1000;
            return (
              <Pill
                key={s}
                onPress={() => update('skipIntervalMs', s * 1000)}
                accessibilityLabel={t('{n} seconds', { n: s })}
                accessibilityState={{ selected: active }}
                aria-selected={active}
                className={`rounded-full border px-4 py-2 ${active ? 'border-amber bg-amber' : 'border-line'}`}
              >
                <Text className={active ? 'text-ink' : 'text-soft'}>{s} s</Text>
              </Pill>
            );
          })}
        </View>
      </View>
      <Row
        label={t('Smart rewind')}
        detail={t('Go back a few seconds when you resume after a pause.')}
      >
        <Toggle value={settings.smartRewind} onValueChange={(v) => update('smartRewind', v)} />
      </Row>
      <Text className="pt-4 text-sm text-muted">
        {t('Sound for every book and show. In the player, a book or show can have its own.')}
      </Text>
      {soundOptions().map((o) => (
        <SoundRow
          key={o.key}
          label={o.label}
          detail={o.detail}
          value={settings[o.key]}
          onChange={(v) => update(o.key, v)}
        />
      ))}
      {/* The web has no calls to make way for. */}
      {Platform.OS === 'android' && (
        <View className="gap-3 border-b border-line py-4">
          <View className="gap-1">
            <Text className="text-base text-paper">{t('During calls')}</Text>
            <Text className="text-sm text-muted">
              {t(
                'Also for other short interruptions. After a pause, playback resumes when the call ends.',
              )}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Choice
              label={t('Pause')}
              active={!settings.duckOnInterruption}
              onPress={() => update('duckOnInterruption', false)}
            />
            <Choice
              label={t('Lower the volume')}
              active={settings.duckOnInterruption}
              onPress={() => update('duckOnInterruption', true)}
            />
          </View>
          {settings.duckOnInterruption && (
            <LevelSlider
              label={t('Volume during calls')}
              value={settings.duckPercent}
              min={DUCK_PERCENT.min}
              max={DUCK_PERCENT.max}
              step={DUCK_PERCENT.step}
              format={(percent) => t('{percent} %', { percent })}
              onChange={(percent) => update('duckPercent', percent)}
            />
          )}
        </View>
      )}
    </SettingsPage>
  );
}
