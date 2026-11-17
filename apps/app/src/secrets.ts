import { createSecretBox, fromBase64Url, type SecretBox, toBase64Url } from '@lelap/core';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_NAME = 'lelap.secrets.v1';

/**
 * The key that seals the sync group key and server passwords in the database. It lives in
 * expo-secure-store (encrypted with an Android Keystore key, left out of backups). When it is
 * missing (first start, or a backup restored on a new phone) a new one is made; secrets sealed
 * with the old one then ask to be paired or entered again.
 */
export function loadSecretBox(): SecretBox {
  let stored = SecureStore.getItem(KEY_NAME);
  if (!stored) {
    stored = toBase64Url(getRandomBytes(32));
    SecureStore.setItem(KEY_NAME, stored);
  }
  return createSecretBox(fromBase64Url(stored), (n) => getRandomBytes(n));
}
