import { getSettings, type Settings, setSetting } from '@lelap/core';
import { useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { t } from '../i18n';
import { db } from '../db';
import * as audio from '../platform/audio';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { Sheet } from './Sheet';

export type SoundKey = 'volumeBoost' | 'voiceEq' | 'mono';

/** The sound switches, in the player's sheet and in Settings → Playback. */
export const soundOptions = (): { key: SoundKey; label: string; detail: string }[] => [
  {
    key: 'volumeBoost',
    label: t('Volume boost'),
    detail: t(
      'Louder, for quiet recordings and speakers. Loud parts are held back so they never distort.',
    ),
  },
  {
    key: 'voiceEq',
    label: t('Voice clarity'),
    detail: t('Cuts rumble and lifts the consonants, so voices are easier to follow.'),
  },
  { key: 'mono', label: t('Mono'), detail: t('Both channels in each ear, for one earbud.') },
];

export const soundActive = (s: Settings): boolean => soundOptions().some((o) => s[o.key]);

/** The listener's settings, with a setter that also tells the player. */
export function useSoundSettings() {
  const { version } = useLibrary();
  const [changes, setChanges] = useState(0);
  // `version` and `changes` are the signals to re-read: a sync or a profile switch, or a switch here.
  const settings = useMemo(() => getSettings(db, profileId), [version, changes]);
  const set = (key: SoundKey, value: boolean) => {
    setSetting(db, profileId, key, value, Date.now());
    setChanges((n) => n + 1);
    void audio.setSettings(getSettings(db, profileId));
  };
  return { settings, set };
}

export function SoundRow({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-4 border-b border-line py-4">
      <View className="flex-1 gap-1">
        <Text className="text-base text-paper">{label}</Text>
        <Text className="text-sm text-muted">{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

/** For every book; changes apply while playing. */
export function SoundSheet({
  visible,
  settings,
  onChange,
  onClose,
}: {
  visible: boolean;
  settings: Settings;
  onChange: (key: SoundKey, value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={t('Sound')} onClose={onClose}>
      <View className="pb-2">
        {soundOptions().map((o) => (
          <SoundRow
            key={o.key}
            label={o.label}
            detail={o.detail}
            value={settings[o.key]}
            onChange={(v) => onChange(o.key, v)}
          />
        ))}
      </View>
    </Sheet>
  );
}
