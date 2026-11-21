import { listProfiles } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { Toggle } from '../../src/components/TextButton';
import { setMarkedCar, useCarChoices } from '../../src/devices';
import { t } from '../../src/i18n';
import { BLUETOOTH } from '../../src/platform/bluetooth';
import { db } from '../../src/db';
import { useLibrary } from '../../src/player';
import { activeProfile } from '../../src/profile';
import { LinkRow, Row, SectionHeader, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';
import { membership } from '../../src/sync';

/** Settings → People and devices: profiles, sync, headphones and the car. */
export default function PeopleSettings() {
  const router = useRouter();
  const { settings, updateDevices } = useSettingsState();
  const me = activeProfile();
  const { version } = useLibrary();
  // `version` is the signal to re-read the database.
  const profiles = useMemo(() => listProfiles(db).length, [version]);
  return (
    <SettingsPage title={t('People and devices')}>
      {!me?.kids && (
        <>
          <LinkRow
            label={t('Profiles')}
            detail={profiles === 1 ? t('1 profile') : t('{n} profiles', { n: profiles })}
            onPress={() => router.push('/profiles')}
          />
          <LinkRow
            label={t('Sync')}
            detail={membership() !== null ? t('On') : t('Off')}
            onPress={() => router.push('/sync')}
          />
        </>
      )}
      {BLUETOOTH && (
        <>
          <SectionHeader text={t('Headphones and car')} />
          <Row
            label={t('Warn about low headphone battery')}
            detail={t(
              'When your Bluetooth headphones or speaker likely won’t last the sleep timer or the chapter. Needs “nearby devices”; devices that don’t report a level show nothing.',
            )}
          >
            <Toggle
              value={settings.headphoneBattery}
              onValueChange={(v) => void updateDevices('headphoneBattery', v)}
            />
          </Row>
          <Row
            label={t('Offer car mode in the car')}
            detail={t(
              'Big buttons when the phone connects to a car’s Bluetooth. Needs “nearby devices”. Car mode is always in the player.',
            )}
          >
            <Toggle
              value={settings.carModeOffer}
              onValueChange={(v) => void updateDevices('carModeOffer', v)}
            />
          </Row>
          {settings.carModeOffer && <MarkedCars />}
        </>
      )}
    </SettingsPage>
  );
}

/** Cars that connect as headphones, marked so car mode is offered for them too (M74). */
function MarkedCars() {
  const choices = useCarChoices();
  return (
    <View className="gap-1 border-b border-line py-4">
      <Text className="text-body text-paper">{t('Your cars')}</Text>
      <Text className="text-detail text-muted">
        {t(
          'Some cars connect as headphones. Mark yours while it is connected, and Lelap offers car mode when it connects.',
        )}
      </Text>
      {choices.length === 0 && (
        <Text className="pt-2 text-detail text-muted">
          {t('Connect to your car’s Bluetooth to mark it here.')}
        </Text>
      )}
      {choices.map((c) => (
        <View key={c.id} className="min-h-12 flex-row items-center gap-4 pt-2">
          <View className="flex-1">
            <Text className="text-body text-paper">{c.name}</Text>
            <Text className="text-detail text-muted">
              {c.connected ? t('Connected') : t('Not connected')}
            </Text>
          </View>
          <Toggle
            value={c.marked}
            accessibilityLabel={t('{name} is my car', { name: c.name })}
            onValueChange={(v) => setMarkedCar(c, v)}
          />
        </View>
      ))}
    </View>
  );
}
