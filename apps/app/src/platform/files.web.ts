import { mimeTypeOf } from '../fileTypes';

/** The text of a file the document picker returned. */
export async function readPickedText(asset: { uri: string; file?: File }): Promise<string> {
  return asset.file ? asset.file.text() : (await fetch(asset.uri)).text();
}

/** Saves a text file through the browser's download. */
export async function shareText(name: string, text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: mimeTypeOf(name) }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves a PNG, given as base64, through the browser's download. */
export async function shareImage(name: string, base64: string): Promise<void> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeTypeOf(name) }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The bytes of a file the document picker returned, for binary files such as databases. */
export async function readPickedBytes(asset: { uri: string; file?: File }): Promise<Uint8Array> {
  const buffer = asset.file
    ? await asset.file.arrayBuffer()
    : await (await fetch(asset.uri)).arrayBuffer();
  return new Uint8Array(buffer);
}
