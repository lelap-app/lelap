/** The text of a file the document picker returned. */
export async function readPickedText(asset: { uri: string; file?: File }): Promise<string> {
  return asset.file ? asset.file.text() : (await fetch(asset.uri)).text();
}

/** Saves a text file through the browser's download. */
export async function shareText(name: string, text: string): Promise<void> {
  const type = name.endsWith('.json') ? 'application/json' : 'text/x-opml';
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
