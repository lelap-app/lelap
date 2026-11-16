import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

export type Part = { url: string; title: string };

export type PlayerState = {
  connected: boolean;
  playing: boolean;
  buffering: boolean;
  /** -1 when nothing is loaded. */
  partIndex: number;
  partCount: number;
  positionMs: number;
  /** 0 when unknown. */
  durationMs: number;
  speed: number;
  duckOnInterruption: boolean;
  lullRemainingMs: number | null;
  error: string | null;
};

type LelapAudioEvents = {
  onStateChange: (state: PlayerState) => void;
};

declare class LelapAudioModule extends NativeModule<LelapAudioEvents> {
  load(bookTitle: string, parts: Part[], startIndex: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekBy(deltaMs: number): Promise<void>;
  skipToPart(index: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  setDuckOnInterruption(enabled: boolean): Promise<void>;
  startLull(minutes: number): Promise<void>;
  cancelLull(): Promise<void>;
  getState(): Promise<PlayerState>;
}

const native = requireNativeModule<LelapAudioModule>('LelapAudio');

export function load(bookTitle: string, parts: Part[], startIndex = 0): Promise<void> {
  return native.load(bookTitle, parts, startIndex);
}

export function play(): Promise<void> {
  return native.play();
}

export function pause(): Promise<void> {
  return native.pause();
}

export function seekBy(deltaMs: number): Promise<void> {
  return native.seekBy(deltaMs);
}

export function skipToPart(index: number): Promise<void> {
  return native.skipToPart(index);
}

export function setSpeed(speed: number): Promise<void> {
  return native.setSpeed(speed);
}

export function setDuckOnInterruption(enabled: boolean): Promise<void> {
  return native.setDuckOnInterruption(enabled);
}

export function startLull(minutes: number): Promise<void> {
  return native.startLull(minutes);
}

export function cancelLull(): Promise<void> {
  return native.cancelLull();
}

export function getState(): Promise<PlayerState> {
  return native.getState();
}

export function addStateListener(listener: (state: PlayerState) => void): EventSubscription {
  return native.addListener('onStateChange', listener);
}
