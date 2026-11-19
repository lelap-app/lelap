import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { TextButton, Toggle } from '../../src/components/TextButton';
import { setMarkedCar, useCarChoices } from '../../src/devices';
import { t } from '../../src/i18n';
import { BLUETOOTH } from '../../src/platform/bluetooth';
import { activeProfile } from '../../src/profile';
import { Row, SectionHeader, SettingsPage } from '../../src/settings/rows';
import { useSettingsState } from '../../src/settings/state';

/** Settings → People and devices: profiles, sync, headphones and the car. */
export default function PeopleSettings() {
  const router = useRouter();
  const { settings, updateDevices } = useSettingsState();
  const me = activeProfile();
  return (
    <SettingsPage title={t('People and devices')}>
      {!me?.kids && (
        <>
          <Row
            label={t('Profiles')}
            detail={t('Everyone who listens here, each with their own places.')}
          >
            <TextButton text={t('Manage')} onPress={() => router.push('/profiles')} />
          </Row>
          <Row
            label={t('Sync')}
            detail={t('Keep your places and podcasts in step on your other devices.')}
          >
            <TextButton text={t('Open')} onPress={() => router.push('/sync')} />
          </Row>
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
      <Text className="text-base text-paper">{t('Your cars')}</Text>
      <Text className="text-sm text-muted">
        {t(
          'Some cars connect as headphones. Mark yours while it is connected, and Lelap offers car mode when it connects.',
        )}
      </Text>
      {choices.length === 0 && (
        <Text className="pt-2 text-sm text-muted">
          {t('Connect to your car’s Bluetooth to mark it here.')}
        </Text>
      )}
      {choices.map((c) => (
        <View key={c.id} className="min-h-12 flex-row items-center gap-4 pt-2">
          <View className="flex-1">
            <Text className="text-base text-paper">{c.name}</Text>
            <Text className="text-sm text-muted">
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
