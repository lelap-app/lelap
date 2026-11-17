import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

/** A connected Bluetooth audio device: headphones, a speaker or a car. */
export type AudioDevice = {
  id: string;
  name: string;
  /** Percent; null when the device reports none. */
  battery: number | null;
  car: boolean;
};

type Events = {
  onChange: (event: { devices: AudioDevice[] }) => void;
};

declare class LelapBluetoothModule extends NativeModule<Events> {
  permitted(): boolean;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  devices(): AudioDevice[];
}

const native = requireNativeModule<LelapBluetoothModule>('LelapBluetooth');

/** Whether Lelap may see connected devices (Android 12+ asks for “nearby devices”). */
export const permitted = (): boolean => native.permitted();

/** Starts following connected audio devices; false without the permission or Bluetooth. */
export const start = (): Promise<boolean> => native.start();

export const stop = (): Promise<void> => native.stop();

export const devices = (): AudioDevice[] => native.devices();

export function addChangeListener(listener: (devices: AudioDevice[]) => void): EventSubscription {
  return native.addListener('onChange', (event) => listener(event.devices));
}
