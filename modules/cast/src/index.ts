import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

/** `upnp`: Sonos and DLNA renderers. `cast`: Google Cast speakers and TVs. `fcast`: FCast. */
export type CastKind = 'upnp' | 'cast' | 'fcast';

export type CastDevice = { id: string; name: string; kind: CastKind; model: string | null };

/**
 * What the receiver reports, about once a second. `closed` means the session ended (handed back
 * to the phone); `lost` means it ended because the receiver went away or could not play.
 */
export type CastStatus = {
  deviceId: string | null;
  state: 'idle' | 'buffering' | 'playing' | 'paused' | 'ended' | 'closed' | 'lost';
  positionMs: number;
  durationMs: number;
  /** 0..1, null when the receiver does not say. */
  volume: number | null;
  error: string | null;
};

/**
 * Android 17's local network permission, checked on every Android 17 device: `granted`, `ask`
 * (explain, then ask) or `blocked` (only Android's settings can turn it on).
 */
export type LocalNetworkAccess = 'granted' | 'ask' | 'blocked';

/** What discovery does, in words from fixed lists; `kind` names the protocol, never a device. */
export type DiscoveryWhat =
  | 'started'
  | 'start-failed'
  | 'stop-failed'
  | 'found'
  | 'resolve-failed'
  | 'resolve-timeout'
  | 'no-address'
  | 'added'
  | 'lost';

/**
 * The search as the sheet needs it. `problem` is `start-failed` when an mDNS search could not
 * start (with NsdManager's code; 7 is no local network access, -1 a call that threw, -2 no
 * answer), or why services that were found could not be added.
 */
export type DiscoveryReport = {
  searching: boolean;
  problem: 'start-failed' | 'resolve-failed' | 'resolve-timeout' | 'no-address' | null;
  code: number | null;
  found: number;
  added: number;
};

/** One kind of discovery event since the last call, with how often it happened. */
export type DiscoveryDiagnostic = {
  at: number;
  what: DiscoveryWhat;
  kind: CastKind;
  code: number | null;
  count: number;
};

/** A `connect()` refused because Android 17's local network access is off. */
export const LOCAL_NETWORK_DENIED = 'ERR_LOCAL_NETWORK';

type LelapCastEvents = {
  onDevices: (event: { devices: CastDevice[] }) => void;
  onStatus: (status: CastStatus) => void;
  onDiscovery: (report: DiscoveryReport) => void;
};

declare class LelapCastModule extends NativeModule<LelapCastEvents> {
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  devices(): Promise<CastDevice[]>;
  discoveryReport(): Promise<DiscoveryReport>;
  takeDiagnostics(): Promise<DiscoveryDiagnostic[]>;
  localNetworkAccess(): Promise<LocalNetworkAccess>;
  requestLocalNetworkAccess(): Promise<LocalNetworkAccess>;
  connect(deviceId: string): Promise<void>;
  session(): Promise<CastDevice | null>;
  setVolume(level: number): Promise<void>;
  disconnect(): Promise<void>;
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

/** How the current or last search went. */
export function discoveryReport(): Promise<DiscoveryReport> {
  return native.discoveryReport();
}

/** Discovery's events since the last call, for the diagnostics log; oldest first. */
export function takeDiagnostics(): Promise<DiscoveryDiagnostic[]> {
  return native.takeDiagnostics();
}

export function addDiscoveryListener(
  listener: (report: DiscoveryReport) => void,
): EventSubscription {
  return native.addListener('onDiscovery', listener);
}

export function localNetworkAccess(): Promise<LocalNetworkAccess> {
  return native.localNetworkAccess();
}

/** Shows Android's prompt; explain why first. */
export function requestLocalNetworkAccess(): Promise<LocalNetworkAccess> {
  return native.requestLocalNetworkAccess();
}

/**
 * Opens a session with the receiver. Playback then moves there with `castTo()` from
 * `@lelap/audio`, whose media session plays through it.
 */
export function connect(deviceId: string): Promise<void> {
  return native.connect(deviceId);
}

/** The receiver of the running session, also after the app was closed and opened again. */
export function session(): Promise<CastDevice | null> {
  return native.session();
}

export function setVolume(level: number): Promise<void> {
  return native.setVolume(level);
}

/** Ends a session that playback never moved to (it failed before). */
export function disconnect(): Promise<void> {
  return native.disconnect();
}

export function addDevicesListener(listener: (devices: CastDevice[]) => void): EventSubscription {
  return native.addListener('onDevices', (event) => listener(event.devices));
}

export function addStatusListener(listener: (status: CastStatus) => void): EventSubscription {
  return native.addListener('onStatus', listener);
}
