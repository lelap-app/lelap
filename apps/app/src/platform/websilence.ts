// Skip silence for the web player (M101, M122). A media element can't drop frames, so this
// decodes the file a little ahead of the place, finds the long pauses, and plays the middle of
// each one four times faster. The element's time stays the file's time, so the place is always
// right. MP3s are decoded by the browser; other files (`webTracks.ts`) packet by packet with
// WebCodecs. A seek in a variable-bitrate MP3 moves the browser's own timeline (M134), and the
// pauses are found again from there. Only audio.web.ts imports this.

import {
  type FastStretch,
  fastStretch,
  PauseMap,
  quietWindows,
  savedByFast,
  type TrackDecoder,
  type TrackPacket,
  WEB_SILENCE_RULES,
  type WebTrack,
} from '@lelap/core';

import type { FileBytes } from './webfile';

/** Decoded this far ahead of the place. */
const AHEAD_MS = 30_000;
const CHUNK_MS = 10_000;
/** The switch back to the listening speed comes this early, as timers can fire late. */
const EARLY_MS = 8;
/** Tries for one place that teach the map nothing, before it waits for the place to move. */
const TRIES = 4;

type Loaded = {
  element: HTMLMediaElement;
  file: FileBytes;
  track: WebTrack;
  /** Replaced when a seek moves the track's timeline. */
  map: PauseMap;
  durationMs: number;
};

type Decoded = { channels: Float32Array[]; sampleRate: number; frames: number };

/** Decodes packets with WebCodecs, in order, into one buffer per channel. */
async function decodePackets(
  config: TrackDecoder,
  data: Uint8Array,
  packets: TrackPacket[],
): Promise<Decoded> {
  const outputs: AudioData[] = [];
  let failure: unknown = null;
  const decoder = new AudioDecoder({
    output: (out) => outputs.push(out),
    error: (error) => {
      failure = error;
    },
  });
  try {
    decoder.configure(config);
    for (const [i, packet] of packets.entries()) {
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          // Only the order matters: where the sound lies comes from the track.
          timestamp: i * 1000,
          data: data.subarray(packet.at, packet.at + packet.size),
        }),
      );
    }
    await decoder.flush();
  } catch (error) {
    for (const out of outputs) out.close();
    throw error;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  if (failure) {
    for (const out of outputs) out.close();
    throw failure;
  }
  // Read before the outputs are closed: a closed AudioData reads as empty.
  const sampleRate = outputs[0]?.sampleRate ?? config.sampleRate;
  const count = outputs[0]?.numberOfChannels ?? 1;
  const frames = outputs.reduce((sum, out) => sum + out.numberOfFrames, 0);
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  let at = 0;
  try {
    for (const out of outputs) {
      for (let c = 0; c < count; c++) {
        const channel = channels[c] as Float32Array;
        out.copyTo(channel.subarray(at, at + out.numberOfFrames), {
          planeIndex: c,
          format: 'f32-planar',
        });
      }
      at += out.numberOfFrames;
    }
  } finally {
    for (const out of outputs) out.close();
  }
  return { channels, sampleRate, frames };
}

/** Decodes MP3 frames with the browser's own decoder. */
async function decodeWhole(bytes: Uint8Array, sampleRate: number): Promise<Decoded> {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const audio = await context.decodeAudioData(bytes.slice().buffer);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
    audio.getChannelData(i),
  );
  return { channels, sampleRate: audio.sampleRate, frames: audio.length };
}

export type SilenceSkipper = ReturnType<typeof createSilenceSkipper>;

/**
 * Plays the element at the listening speed, and faster through long pauses while `on`.
 * `onSaved` gets the listening time each fast stretch saved, in milliseconds.
 */
export function createSilenceSkipper(onSaved: (ms: number) => void) {
  let on = false;
  let speed = 1;
  let loaded: Loaded | null = null;
  let fast = false;
  let lastMs: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let decoding = false;
  // The last seek, which a track opened later (the part started mid-file) must still hear about.
  let lastSeek: { element: HTMLMediaElement; src: string; toMs: number } | null = null;
  const heard = new WeakSet<HTMLMediaElement>();
  const onSeeking = (event: Event) => {
    const element = event.target as HTMLMediaElement;
    lastSeek = { element, src: element.currentSrc, toMs: element.currentTime * 1000 };
    const current = loaded;
    if (current?.element === element && current.track.seeked?.(lastSeek.toMs)) {
      current.map = new PauseMap(current.durationMs);
      lastFromMs = null;
      tries = 0;
    }
  };
  // Where the last chunk was asked for, and how often: a place that teaches nothing isn't asked
  // for again and again.
  let lastFromMs: number | null = null;
  let tries = 0;
  // A read that failed (offline, say) is tried again after a while, not with every look.
  let retryAt = 0;
  const rate = WEB_SILENCE_RULES.rate;

  const setRate = (element: HTMLMediaElement, faster: boolean) => {
    fast = faster;
    const wanted = speed * (faster ? rate : 1);
    if (element.playbackRate !== wanted) element.playbackRate = wanted;
  };

  /** Counts media played fast since the last look; a seek in between counts nothing. */
  const count = (nowMs: number) => {
    if (fast && lastMs !== null) {
      const moved = nowMs - lastMs;
      if (moved > 0 && moved < 5_000) onSaved(savedByFast(moved, rate, speed));
    }
    lastMs = nowMs;
  };

  const wake = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        tick();
      },
      Math.max(0, ms),
    );
  };

  /** Fast inside a pause's stretch, the listening speed elsewhere; then waits for the next edge. */
  function tick(): void {
    const current = loaded;
    if (!current) return;
    const { element } = current;
    const nowMs = element.currentTime * 1000;
    // A seek sets the time before its event: the jump isn't fast play.
    if (element.seeking) lastMs = null;
    else count(nowMs);
    if (!on || element.paused || element.seeking) {
      setRate(element, false);
      return;
    }
    void decodeAhead();
    let pause = current.map.nextPause(nowMs, AHEAD_MS);
    let stretch: FastStretch | null = pause ? fastStretch(pause) : null;
    // Past this pause's fast stretch, in its slow end: the next pause is the one to wait for.
    if (pause && (!stretch || nowMs >= stretch.toMs)) {
      pause = current.map.nextPause(pause.endMs, AHEAD_MS);
      stretch = pause ? fastStretch(pause) : null;
    }
    if (stretch && nowMs >= stretch.fromMs && nowMs < stretch.toMs) {
      const leftMs = (stretch.toMs - nowMs) / (speed * rate);
      if (leftMs <= EARLY_MS) {
        setRate(element, false);
        wake(EARLY_MS * 2);
        return;
      }
      setRate(element, true);
      // Close to the end, look again often, so the voice comes back at its own speed.
      wake(leftMs > 60 ? leftMs - 40 : leftMs - EARLY_MS);
      return;
    }
    setRate(element, false);
    if (stretch && nowMs < stretch.fromMs) wake((stretch.fromMs - nowMs) / speed);
    else wake(500);
  }

  /** Decodes the next chunk ahead of the place, one at a time. */
  async function decodeAhead(): Promise<void> {
    const current = loaded;
    if (!current || decoding) return;
    const placeMs = current.element.currentTime * 1000;
    const fromMs = current.map.knownUntil(placeMs);
    const durationMs = Number.isFinite(current.element.duration)
      ? current.element.duration * 1000
      : Infinity;
    if (fromMs - placeMs >= AHEAD_MS || fromMs >= durationMs - current.map.windowMs) return;
    if (fromMs !== lastFromMs) tries = 0;
    if (tries >= TRIES || Date.now() < retryAt) return;
    lastFromMs = fromMs;
    tries++;
    decoding = true;
    try {
      const { track, map } = current;
      const range = track.range(fromMs, CHUNK_MS);
      const bytes = await current.file.read(range.start, range.end);
      // Another file, or a seek that moved the timeline while this was read.
      if (loaded !== current || current.map !== map) return;
      if (!bytes) {
        tries = 0;
        lastFromMs = null;
        retryAt = Date.now() + 10_000;
        return;
      }
      const run = track.run(bytes, range.start);
      if (!run) return;
      const data = run.data ?? bytes;
      const first = run.packets[0] as TrackPacket;
      const last = run.packets[run.packets.length - 1] as TrackPacket;
      const decoded = track.decoder
        ? await decodePackets(track.decoder, data, run.packets)
        : await decodeWhole(data.subarray(first.at, last.at + last.size), track.sampleRate);
      if (loaded !== current || current.map !== map || decoded.frames === 0) return;
      // Sound placed by its end starts as long before it as the decoder gave back.
      const startMs =
        run.startMs ?? (run.endMs ?? 0) - (decoded.frames / decoded.sampleRate) * 1000;
      const windows = quietWindows(decoded.channels, decoded.sampleRate);
      const skip = Math.ceil(run.skipMs / map.windowMs);
      const drop = Math.ceil(run.dropMs / map.windowMs);
      const keep = windows.slice(skip, Math.max(skip, windows.length - drop));
      map.mark(startMs + skip * map.windowMs, keep);
      // The element has played what lies well behind this chunk.
      current.file.forget(range.start - 1024 * 1024);
    } catch {
      // A chunk that doesn't decode is left unknown: no pause is found there.
    } finally {
      decoding = false;
    }
    // The place may have moved on while decoding.
    if (loaded === current && on) tick();
  }

  const events = ['play', 'pause', 'seeked', 'seeking', 'playing'] as const;
  const onEvent = () => {
    // A seek leaves nothing counted across it.
    if (loaded?.element.seeking) lastMs = null;
    tick();
  };

  return {
    /** A new file in the element: null when it can't be read or its format isn't known. */
    attach(element: HTMLMediaElement, file: FileBytes | null, track: WebTrack | null): void {
      this.detach();
      // Seeks are heard from the start of each file, before its track is open.
      if (!heard.has(element)) {
        heard.add(element);
        element.addEventListener('seeking', onSeeking);
      }
      lastMs = null;
      lastFromMs = null;
      tries = 0;
      retryAt = 0;
      fast = false;
      if (file && track) {
        const durationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
        // The file was seeked before its track opened (a start mid-part): its timeline is there.
        const seek = lastSeek;
        if (seek && seek.element === element && seek.src === element.currentSrc)
          track.seeked?.(seek.toMs);
        loaded = { element, file, track, map: new PauseMap(durationMs), durationMs };
        for (const type of events) element.addEventListener(type, onEvent);
      }
      element.playbackRate = speed;
      tick();
    },
    detach(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      const current = loaded;
      loaded = null;
      if (current) {
        count(current.element.currentTime * 1000);
        for (const type of events) current.element.removeEventListener(type, onEvent);
        current.element.playbackRate = speed;
      }
      fast = false;
    },
    setOn(next: boolean): void {
      on = next;
      tick();
    },
    /** The listening speed; inside a pause the element plays faster than this. */
    setSpeed(next: HTMLMediaElement | null, value: number): void {
      speed = value;
      if (next) next.playbackRate = speed * (fast ? rate : 1);
      tick();
    },
    /** Whether the element plays faster than the listening speed now, for diagnostics. */
    get fast(): boolean {
      return fast;
    },
    /** The kind of file skip silence reads, for diagnostics. */
    get kind(): WebTrack['kind'] | null {
      return loaded?.track.kind ?? null;
    },
    /** The pauses found in the file playing, for diagnostics. */
    get map(): PauseMap | null {
      return loaded?.map ?? null;
    },
  };
}
