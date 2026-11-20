// Reads bytes of the file the web player plays, for skip silence and even loudness (M101, M122):
// from the downloaded file in OPFS, or from what the element streams (passed on by the service
// worker), else straight from the audio host with a range request. Never through Lelap's
// services: audio doesn't touch them.

import {
  flacInfo,
  flacTrack,
  id3v2Size,
  mp3Track,
  mp4BoxHeader,
  mp4Index,
  mp4Track,
  oggCodec,
  oggTrack,
  readTags,
  TAG_READ_BYTES,
  type TrackHead,
  vbrMp3Track,
  trackHead,
  type WebTrack,
} from '@lelap/core';

import * as tee from './webtee';

export type FileBytes = {
  /** Bytes `from` up to `to`, or fewer at the end of the file; null when they can't be read. */
  read(from: number, to: number): Promise<Uint8Array | null>;
  /** The file's size in bytes, when it can be learnt. */
  size(): Promise<number | null>;
  /** Bytes before `byte` won't be asked for again soon. */
  forget(byte: number): void;
};

export function blobBytes(blob: Blob): FileBytes {
  return {
    read: async (from, to) =>
      new Uint8Array(await blob.slice(Math.max(0, from), Math.max(from, to)).arrayBuffer()),
    size: async () => blob.size,
    forget: () => {},
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The element's own stream when the service worker passes it on; range requests to a host that
 * allows CORS otherwise. A host that sends the whole file is left alone.
 */
export function urlBytes(url: string): FileBytes {
  let refused = false;
  let size: number | null = null;
  const fetchRange = async (from: number, to: number): Promise<Uint8Array | null> => {
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
      const bytes = new Uint8Array(await response.arrayBuffer());
      tee.teeCounts.own += bytes.length;
      return bytes;
    } catch {
      return null;
    }
  };
  return {
    read: async (from, to) => {
      // The element reads well ahead of the place; what it hasn't reached yet comes soon.
      const end = Math.min(to, tee.size(url) ?? to);
      let part = tee.covered(url, from, end);
      for (let i = 0; i < 8 && (!part || part.to < end) && tee.flowing(url); i++) {
        await wait(250);
        part = tee.covered(url, from, end);
      }
      if (tee.flowing(url) && part?.to !== end) void tee.watch(url);
      const shared = part ? tee.read(url, part.from, part.to) : null;
      if (!part || !shared) return fetchRange(from, to);
      tee.teeCounts.shared += shared.length;
      // What the element didn't fetch (just before a seek's place, or not yet) is fetched here.
      const before = part.from > from ? await fetchRange(from, part.from) : new Uint8Array(0);
      const after = part.to < end ? await fetchRange(part.to, end) : new Uint8Array(0);
      if (!before || !after) return null;
      const joined = new Uint8Array(before.length + shared.length + after.length);
      joined.set(before);
      joined.set(shared, before.length);
      joined.set(after, before.length + shared.length);
      return joined;
    },
    size: async () => {
      size ??= tee.size(url);
      if (size) return size;
      try {
        const response = await fetch(url, { method: 'HEAD', mode: 'cors' });
        size = Number(response.headers.get('content-length')) || null;
      } catch {
        size = null;
      }
      return size;
    },
    forget: (byte) => tee.forget(url, byte),
  };
}

export type FileHead = {
  /** Name and value tags, for ReplayGain. */
  tags: [string, string][];
  /** The first bytes, after any ID3v2 tag. */
  head: Uint8Array;
  /** Where the sound lies, for skip silence; null for files it doesn't know. */
  track: TrackHead | null;
  size: number | null;
};

const HEAD_BYTES = 64 * 1024;

/** The tags and where the sound lies, from the start of a file. */
export async function readHead(file: FileBytes): Promise<FileHead | null> {
  const head = await file.read(0, HEAD_BYTES);
  if (!head || head.length < 10) return null;
  const size = await file.size();
  const tagSize = id3v2Size(head);
  // A cover in the ID3 tag can be large; the text frames sit within the first bytes.
  const tagBytes =
    tagSize > head.length ? await file.read(0, Math.min(tagSize, TAG_READ_BYTES)) : head;
  const audio =
    tagSize > 0 && tagSize + 16 * 1024 > head.length
      ? await file.read(tagSize, tagSize + 16_384)
      : null;
  let track = audio ? trackHead(audio, size) : trackHead(head, size);
  // Places found in bytes read after the tag move by its size.
  if (audio && track?.kind === 'mp3')
    track = {
      ...track,
      layout: { ...track.layout, audioStart: track.layout.audioStart + tagSize },
    };
  else if (audio && track?.kind === 'vbr-mp3')
    track = { ...track, audioStart: track.audioStart + tagSize };
  else if (audio) track = null;
  return { tags: tagBytes ? readTags(tagBytes) : [], head, track, size };
}

/**
 * Whether this browser seeks a variable-bitrate MP3 the way `xingSeek` describes: Chrome and the
 * browsers built on it (M134). Firefox estimates the frame from an average instead, a frame or
 * three off, and Safari wasn't measured; there these files play unchanged.
 */
export function seeksByXingTable(userAgent: string): boolean {
  return (
    /\b(Chrome|Chromium)\//.test(userAgent) && !/\b(Firefox|FxiOS|CriOS|EdgiOS)\//.test(userAgent)
  );
}

/** Bigger tables than this aren't read: about 80 hours of AAC. */
const MOOV_LIMIT = 48 * 1024 * 1024;

/**
 * The track skip silence decodes: null for a file it doesn't know, or one whose codec this browser
 * can't decode with WebCodecs.
 */
export async function openTrack(
  file: FileBytes,
  { head, track, size }: FileHead,
  durationMs: number,
): Promise<WebTrack | null> {
  let opened: WebTrack | null = null;
  if (track?.kind === 'mp3') opened = mp3Track(track.layout);
  // A variable-bitrate MP3's time after a seek is the browser's own guess (M134): followed where
  // it is known, from the Xing table of contents; elsewhere the file plays unchanged.
  else if (track?.kind === 'vbr-mp3')
    opened =
      track.xing?.toc &&
      (track.xing.bytes || size) &&
      typeof navigator !== 'undefined' &&
      seeksByXingTable(navigator.userAgent)
        ? vbrMp3Track(track, size)
        : null;
  else if (track?.kind === 'ogg') {
    const codec = oggCodec(head);
    opened = codec ? oggTrack(codec, size, durationMs) : null;
  } else if (track?.kind === 'flac') {
    // A large picture block can push the frames past the first bytes.
    let info = track.info;
    if (info.audioStart === null) {
      const more = await file.read(0, 4 * 1024 * 1024);
      info = (more && flacInfo(more, id3v2Size(more))) || info;
    }
    opened = info.audioStart === null ? null : flacTrack(info, size, durationMs);
  } else if (track?.kind === 'mp4') {
    let { at, size: moovSize } = track.moov;
    // Past an `mdat` that comes first, box headers are read one by one to the `moov`.
    for (let hop = 0; moovSize === null && hop < 4; hop++) {
      const header = await file.read(at, at + 16);
      const box = header ? mp4BoxHeader(header) : null;
      if (!box) break;
      if (box.type === 'moov') moovSize = box.size;
      else at += box.size;
    }
    const moov = moovSize && moovSize <= MOOV_LIMIT ? await file.read(at, at + moovSize) : null;
    const index = moov ? mp4Index(moov) : null;
    opened = index ? mp4Track(index) : null;
  }
  if (!opened?.decoder) return opened;
  try {
    const { supported } = await AudioDecoder.isConfigSupported(opened.decoder);
    return supported ? opened : null;
  } catch {
    // No WebCodecs: the book plays without skip silence.
    return null;
  }
}
