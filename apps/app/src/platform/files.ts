import { File } from 'expo-file-system';
import { Share } from 'react-native';

/** The text of a file the document picker returned. */
export function readPickedText(asset: { uri: string }): Promise<string> {
  return new File(asset.uri).text();
}

/** Hands a text file to another app through the share sheet. */
export async function shareText(name: string, text: string): Promise<void> {
  await Share.share({ title: name, message: text });
}

/** The bytes of a file the document picker returned, for binary files such as databases. */
export async function readPickedBytes(asset: { uri: string }): Promise<Uint8Array> {
  return new Uint8Array(await new File(asset.uri).arrayBuffer());
}
