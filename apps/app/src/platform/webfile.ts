// Reads bytes of the file the web player plays, for skip silence and even loudness (M101): from
// the downloaded file in OPFS, or straight from the audio host with a range request. Never
// through Lelap's services: audio doesn't touch them.

import { id3v2Size, type Mp3Layout, mp3Layout, readTags, TAG_READ_BYTES } from '@lelap/core';

export type FileBytes = {
  /** Bytes `from` up to `to`, or fewer at the end of the file; null when they can't be read. */
  read(from: number, to: number): Promise<Uint8Array | null>;
};

export function blobBytes(blob: Blob): FileBytes {
  return {
    read: async (from, to) =>
      new Uint8Array(await blob.slice(Math.max(0, from), Math.max(from, to)).arrayBuffer()),
  };
}

/** Range requests to a host that allows CORS; a host that sends the whole file is left alone. */
export function urlBytes(url: string): FileBytes {
  let refused = false;
  return {
    read: async (from, to) => {
      if (refused || to <= from) return null;
      try {
        const response = await fetch(url, {
          mode: 'cors',
          headers: { Range: `bytes=${Math.max(0, from)}-${to - 1}` },
        });
        if (response.status !== 206) {
          refused = true;
          await response.body?.cancel();
          return null;
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}

export type FileHead = {
  /** Name and value tags, for ReplayGain. */
  tags: [string, string][];
  /** Where a constant-bitrate MP3's audio sits, for skip silence; null for other files. */
  layout: Mp3Layout | null;
};

const HEAD_BYTES = 64 * 1024;

/** The tags and the MP3 layout from the start of a file. */
export async function readHead(file: FileBytes): Promise<FileHead | null> {
  const head = await file.read(0, HEAD_BYTES);
  if (!head || head.length < 10) return null;
  const tagSize = id3v2Size(head);
  // A cover in the ID3 tag can be large; the text frames sit within the first bytes.
  const tagBytes =
    tagSize > head.length ? await file.read(0, Math.min(tagSize, TAG_READ_BYTES)) : head;
  const audio =
    tagSize + 16 * 1024 > head.length ? await file.read(tagSize, tagSize + 16_384) : null;
  const layout = audio ? mp3Layout(audio, 0) : mp3Layout(head, tagSize);
  return {
    tags: tagBytes ? readTags(tagBytes) : [],
    layout: layout && audio ? { ...layout, audioStart: layout.audioStart + tagSize } : layout,
  };
}
