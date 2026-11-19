import { checkPin, listProfiles, type Profile } from '@lelap/core';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { Icon } from './Icon';
import { db } from '../db';
import { switchProfile, useLibrary } from '../player';
import { profileId } from '../profile';
import { Avatar } from './Avatar';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

/**
 * “Who's listening?”: tap a profile; one with a PIN asks for it first. At launch (`atLaunch`)
 * that includes the profile used last; switching back to the current one does not ask.
 */
export function ProfilePicker({
  onPicked,
  atLaunch = false,
}: {
  onPicked: () => void;
  atLaunch?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  // `version` is the signal to re-read the database.
  const profiles = useMemo(() => listProfiles(db), [version]);
  const [asking, setAsking] = useState<Profile | null>(null);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  const open = async (profile: Profile) => {
    await switchProfile(profile.id);
    refresh();
    onPicked();
  };

  const choose = (profile: Profile) => {
    if (profile.pinHash && (atLaunch || profile.id !== profileId)) {
      setAsking(profile);
      setPin('');
      setWrong(false);
    } else {
      void open(profile);
    }
  };

  const enter = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    setWrong(false);
    if (digits.length === 4 && asking) {
      if (checkPin(db, asking.id, digits)) void open(asking);
      else {
        setWrong(true);
        setPin('');
      }
    }
  };

  return (
    <View
      style={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
      className="flex-1 items-center gap-8 bg-night px-6"
    >
      <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
        {asking ? asking.name : t('Who’s listening?')}
      </Text>
      {asking ? (
        <View className="items-center gap-4">
          <Avatar avatar={asking.avatar} name={asking.name} size={96} />
          <TextInput
            value={pin}
            onChangeText={enter}
            autoFocus
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder={t('PIN')}
            accessibilityLabel={t('PIN')}
            placeholderTextColor={colors.muted}
            className="w-40 rounded-lg border border-line px-3 py-3 text-center text-2xl tracking-[12px] text-paper"
          />
          {wrong && (
            <Text accessibilityLiveRegion="assertive" className="text-danger">
              {t('That PIN is not right.')}
            </Text>
          )}
          <TextButton text={t('Back')} tone="muted" onPress={() => setAsking(null)} />
        </View>
      ) : (
        <View className="flex-row flex-wrap justify-center gap-6">
          {profiles.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => choose(p)}
              accessibilityRole="button"
              className="items-center gap-2 active:opacity-70"
            >
              <Avatar avatar={p.avatar} name={p.name} size={96} />
              <View className="flex-row items-center gap-1">
                <Text className="text-paper">{p.name}</Text>
                {p.pinHash ? (
                  <Icon name="lock" size={14} color={colors.muted} label={t('PIN')} />
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
