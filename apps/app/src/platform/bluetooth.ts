// Android: connected Bluetooth audio devices (M33). The web cannot see them; see bluetooth.web.ts.
import { PermissionsAndroid, Platform } from 'react-native';

export * from '@lelap/bluetooth';
export const BLUETOOTH = true;

/** Asks for “nearby devices” on Android 12+; older versions grant Bluetooth at install. */
export async function requestPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 31) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}
