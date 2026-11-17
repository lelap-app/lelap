import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

/** `upnp`: Sonos and DLNA renderers. `cast`: Google Cast speakers and TVs. `fcast`: FCast. */
export type CastKind = 'upnp' | 'cast' | 'fcast';

export type CastDevice = { id: string; name: string; kind: CastKind; model: string | null };

/**
 * What the receiver reports, about once a second. `lost` means the connection dropped; the
 * session is over and the phone takes playback back.
 */
export type CastStatus = {
  deviceId: string | null;
  state: 'idle' | 'buffering' | 'playing' | 'paused' | 'ended' | 'lost';
  positionMs: number;
  durationMs: number;
  /** 0..1, null when the receiver does not say. */
  volume: number | null;
  error: string | null;
};

/**
 * One file for the receiver. Files on the phone (`file://`, `content://`) and streams that need
 * a login are served to the receiver from the phone; other URLs are fetched by the receiver.
 */
export type CastMedia = {
  uri: string;
  title: string;
  artist: string | null;
  album: string | null;
  coverUri: string | null;
  durationMs: number;
  headers?: Record<string, string>;
};

type LelapCastEvents = {
  onDevices: (event: { devices: CastDevice[] }) => void;
  onStatus: (status: CastStatus) => void;
};

declare class LelapCastModule extends NativeModule<LelapCastEvents> {
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  devices(): Promise<CastDevice[]>;
  connect(deviceId: string): Promise<void>;
  load(mediaJson: string, startMs: number, autoplay: boolean, speed: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  setVolume(level: number): Promise<void>;
  status(): Promise<CastStatus | null>;
  disconnect(): Promise<number | null>;
}

const native = requireNativeModule<LelapCastModule>('LelapCast');

export const isSupported = (): boolean => true;

/** Looks for receivers on the Wi-Fi until [stopDiscovery]. */
export function startDiscovery(): Promise<void> {
  return native.startDiscovery();
}

export function stopDiscovery(): Promise<void> {
  return native.stopDiscovery();
}

/** Receivers found so far in this run of the app. */
export function devices(): Promise<CastDevice[]> {
  return native.devices();
}

export function connect(deviceId: string): Promise<void> {
  return native.connect(deviceId);
}

export function load(
  media: CastMedia,
  startMs: number,
  autoplay: boolean,
  speed: number,
): Promise<void> {
  return native.load(JSON.stringify(media), startMs, autoplay, speed);
}

export function play(): Promise<void> {
  return native.play();
}

export function pause(): Promise<void> {
  return native.pause();
}

export function seek(positionMs: number): Promise<void> {
  return native.seek(positionMs);
}

/** Google Cast and FCast only; UPnP renderers play at 1×. */
export function setSpeed(speed: number): Promise<void> {
  return native.setSpeed(speed);
}

export function setVolume(level: number): Promise<void> {
  return native.setVolume(level);
}

export function status(): Promise<CastStatus | null> {
  return native.status();
}

/** Stops the receiver and ends the session; resolves to the last place in the file. */
export function disconnect(): Promise<number | null> {
  return native.disconnect();
}

export function addDevicesListener(listener: (devices: CastDevice[]) => void): EventSubscription {
  return native.addListener('onDevices', (event) => listener(event.devices));
}

export function addStatusListener(listener: (status: CastStatus) => void): EventSubscription {
  return native.addListener('onStatus', listener);
}
