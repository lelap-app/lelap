import { nowPlayingLine } from '@lelap/core';

// HLS on the web (M154): the browser's own player where it has one (Safari, Chrome on Android
// and newer desktop Chrome), else hls.js's light build, loaded only then. Now playing comes from
// the playlist's timed ID3 tags, which both expose as cues on a metadata text track. A browser
// gives a page no ICY metadata, so a plain live MP3 stream shows none.

type Detach = () => void;

const NATIVE_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl'];

const playsNatively = (audio: HTMLAudioElement) =>
  NATIVE_TYPES.some((type) => audio.canPlayType(type) !== '');

let attached: { audio: HTMLAudioElement; detach: Detach } | null = null;

/** Lets go of hls.js on the element, before it plays anything else. */
export function detachHls(): void {
  attached?.detach();
  attached = null;
}

/**
 * Starts loading an HLS playlist into the element. Resolves once the element has a source; the
 * caller waits for `loadedmetadata` as for any file.
 */
export async function attachHls(audio: HTMLAudioElement, src: string): Promise<void> {
  detachHls();
  if (playsNatively(audio)) {
    audio.src = src;
    audio.load();
    return;
  }
  const { default: Hls } = await import('hls.js/light');
  if (!Hls.isSupported()) {
    // No Media Source Extensions: let the element try, and fail with its own error.
    audio.src = src;
    audio.load();
    return;
  }
  // A live playlist starts near what is on air, and never buffers far behind it.
  const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
  // A dead playlist (404, CORS, no network) fails as the element would, so the player stops
  // waiting for it and says so.
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal && attached?.audio === audio) audio.dispatchEvent(new Event('error'));
  });
  hls.loadSource(src);
  hls.attachMedia(audio);
  attached = {
    audio,
    detach: () => {
      hls.destroy();
      audio.removeAttribute('src');
    },
  };
}

type Id3Value = { key?: unknown; data?: unknown; info?: unknown };

function id3Of(cue: TextTrackCue): Id3Value | null {
  const value = (cue as TextTrackCue & { value?: unknown }).value;
  return value && typeof value === 'object' ? (value as Id3Value) : null;
}

/**
 * Calls back with the line under the station's name whenever a timed ID3 tag changes it; a
 * returned function stops listening.
 */
export function watchNowPlaying(
  audio: HTMLAudioElement,
  onLine: (line: string | null) => void,
): Detach {
  const watched = new Set<TextTrack>();
  const read = (track: TextTrack) => {
    const frames: Record<string, string> = {};
    for (const cue of Array.from(track.activeCues ?? [])) {
      const value = id3Of(cue);
      if (value && typeof value.key === 'string' && typeof value.data === 'string')
        frames[value.key] = value.data;
    }
    if (!frames.TIT2 && !frames.TPE1) return;
    onLine(nowPlayingLine({ title: frames.TIT2 ?? null, artist: frames.TPE1 ?? null }));
  };
  const watch = (track: TextTrack | null) => {
    if (!track || track.kind !== 'metadata' || watched.has(track)) return;
    watched.add(track);
    // A disabled track fires no cue changes.
    if (track.mode === 'disabled') track.mode = 'hidden';
    track.addEventListener('cuechange', () => read(track));
  };
  const added = (event: TrackEvent) => watch(event.track as TextTrack | null);
  for (const track of Array.from(audio.textTracks)) watch(track);
  audio.textTracks.addEventListener('addtrack', added);
  return () => audio.textTracks.removeEventListener('addtrack', added);
}
