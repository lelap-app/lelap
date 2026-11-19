// Skip silence for the web player (M101). A media element can't drop frames, so this decodes the
// file a little ahead of the place, finds the long pauses, and plays the middle of each one four
// times faster. The element's time stays the file's time, so the place is always right. Only
// constant-bitrate MP3s for now: their bytes map evenly onto time. Only audio.web.ts imports this.

import {
  type FastStretch,
  fastStretch,
  findMp3Frame,
  type Mp3Layout,
  mp3ByteAt,
  mp3MsAt,
  PauseMap,
  quietWindows,
  savedByFast,
  WEB_SILENCE_RULES,
} from '@lelap/core';

import type { FileBytes } from './webfile';

/** Decoded this far ahead of the place. */
const AHEAD_MS = 30_000;
const CHUNK_MS = 10_000;
/** Frames decoded before each chunk and thrown away: MP3 frames borrow bits from earlier ones. */
const WARM_UP_FRAMES = 2;
/** The switch back to the listening speed comes this early, as timers can fire late. */
const EARLY_MS = 8;

type Loaded = {
  element: HTMLMediaElement;
  file: FileBytes;
  layout: Mp3Layout;
  map: PauseMap;
};

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
  // Where the last chunk started: one that taught nothing isn't asked for again.
  let lastFromMs: number | null = null;
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
    count(nowMs);
    if (!on || element.paused || element.seeking) {
      setRate(element, false);
      return;
    }
    void decodeAhead();
    const pause = current.map.nextPause(nowMs, AHEAD_MS);
    const stretch: FastStretch | null = pause ? fastStretch(pause) : null;
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
    if (fromMs - placeMs >= AHEAD_MS || fromMs >= durationMs || fromMs === lastFromMs) return;
    lastFromMs = fromMs;
    decoding = true;
    try {
      const { layout } = current;
      const warmUp = WARM_UP_FRAMES * layout.frameBytes;
      // Two frames more than the warm-up (the first whole frame may come a frame in), so what
      // is kept starts at or before `fromMs` and the map has no gap.
      const start = Math.max(
        layout.audioStart,
        Math.floor(mp3ByteAt(layout, fromMs) - warmUp - 2 * layout.frameBytes),
      );
      const end = start + Math.ceil((CHUNK_MS / 1000) * layout.bytesPerSecond + 2 * warmUp);
      const bytes = await current.file.read(start, end);
      if (!bytes || loaded !== current) return;
      const at = findMp3Frame(bytes, 0);
      if (at === null) return;
      const context = new OfflineAudioContext(1, 1, layout.sampleRate);
      const audio = await context.decodeAudioData(bytes.slice(at).buffer);
      if (loaded !== current) return;
      const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
        audio.getChannelData(i),
      );
      const windows = quietWindows(channels, audio.sampleRate);
      const frameWindows = Math.ceil(
        (layout.samplesPerFrame / layout.sampleRate) * (1000 / current.map.windowMs),
      );
      const skip = start + at === layout.audioStart ? 0 : WARM_UP_FRAMES * frameWindows;
      // The last frame may be cut short; the next chunk decodes it again.
      const keep = windows.slice(skip, Math.max(skip, windows.length - frameWindows));
      current.map.mark(mp3MsAt(layout, start + at) + skip * current.map.windowMs, keep);
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
    /** A new file in the element: null when it isn't a constant-bitrate MP3 or can't be read. */
    attach(element: HTMLMediaElement, file: FileBytes | null, layout: Mp3Layout | null): void {
      this.detach();
      lastMs = null;
      lastFromMs = null;
      fast = false;
      if (file && layout) {
        const durationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
        loaded = { element, file, layout, map: new PauseMap(durationMs) };
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
    /** The pauses found in the file playing, for diagnostics. */
    get map(): PauseMap | null {
      return loaded?.map ?? null;
    },
  };
}
