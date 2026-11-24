import { savedTranscriptName } from '@lelap/core';
import { Directory, File, Paths } from 'expo-file-system';

// Transcripts kept with a downloaded book (M159), so the transcript screen works offline: one
// folder per book, a file per transcript address, removed with the download.

const MAX_BYTES = 5 * 1024 * 1024;

const folder = (bookId: string) => new Directory(Paths.document, 'transcripts', bookId);

/** The kept text of a book's transcript, or null when there is none. */
export async function savedTranscript(bookId: string, url: string): Promise<string | null> {
  try {
    const file = new File(folder(bookId), savedTranscriptName(url));
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

/** Whether a book's transcript is kept already. */
export function hasSavedTranscript(bookId: string, url: string): boolean {
  try {
    return new File(folder(bookId), savedTranscriptName(url)).exists;
  } catch {
    return false;
  }
}

/** Keeps a transcript's text with a book; a very large one is left to the network. */
export function saveTranscript(bookId: string, url: string, text: string): void {
  if (text.length > MAX_BYTES) return;
  const dir = folder(bookId);
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, savedTranscriptName(url));
  if (file.exists) file.delete();
  file.create();
  file.writeSync(text);
}

/** Removes every transcript kept with a book, such as when its download goes. */
export function dropTranscripts(bookId: string): void {
  try {
    const dir = folder(bookId);
    if (dir.exists) dir.delete();
  } catch {
    // Left for the next removal; a few kilobytes.
  }
}

/** Whether transcripts are kept with downloads on this platform. */
export const KEEPS_TRANSCRIPTS = true;
