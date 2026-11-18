import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { mimeTypeOf } from '../fileTypes';

/** The text of a file the document picker returned. */
export function readPickedText(asset: { uri: string }): Promise<string> {
  return new File(asset.uri).text();
}

/**
 * Hands a text file to another app through the share sheet, as a real file with its name, so
 * Files, Drive or mail keep it as `lelap-library-….json` instead of a pasted message.
 */
export async function shareText(name: string, text: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    await Share.share({ title: name, message: text });
    return;
  }
  // The cache folder: Android clears it when space runs low, and the next share overwrites it.
  const folder = new Directory(Paths.cache, 'shared');
  if (!folder.exists) folder.create({ intermediates: true });
  const file = new File(folder, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: mimeTypeOf(name), dialogTitle: name });
}

/** Hands a PNG, given as base64, to another app through the share sheet. */
export async function shareImage(name: string, base64: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available');
  const folder = new Directory(Paths.cache, 'shared');
  if (!folder.exists) folder.create({ intermediates: true });
  const file = new File(folder, name);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, { mimeType: mimeTypeOf(name), dialogTitle: name });
}

/** The bytes of a file the document picker returned, for binary files such as databases. */
export async function readPickedBytes(asset: { uri: string }): Promise<Uint8Array> {
  return new Uint8Array(await new File(asset.uri).arrayBuffer());
}
