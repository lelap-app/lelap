import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

/** The hinge in window points; the same shape as `Fold` in @lelap/core, which decides the layout. */
export type Hinge = {
  orientation: 'vertical' | 'horizontal';
  /** Half open, or a hinge that hides part of the screen. */
  separating: boolean;
  start: number;
  end: number;
  /** The window the hinge was measured in, in points (M120). */
  window: { width: number; height: number };
};

type Events = {
  onChange: (event: { fold: Hinge | null }) => void;
};

declare class LelapFoldModule extends NativeModule<Events> {
  current(): Hinge | null;
  start(): Promise<void>;
}

const native = requireNativeModule<LelapFoldModule>('LelapFold');

/** The hinge across the window now, or null on a flat screen or a device without one. */
export const current = (): Hinge | null => native.current();

/** Starts following the hinge; changes arrive through `addChangeListener`. */
export const start = (): Promise<void> => native.start();

export function addChangeListener(listener: (fold: Hinge | null) => void): EventSubscription {
  return native.addListener('onChange', (event) => listener(event.fold));
}
