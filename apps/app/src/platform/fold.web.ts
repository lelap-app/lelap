import type { Hinge } from '@lelap/fold';

// Browsers tell a page nothing about a hinge, so the web lays out by the window alone.
export type { Hinge };
export const current = (): Hinge | null => null;
export const start = async (): Promise<void> => {};
export const addChangeListener = (listener: (fold: Hinge | null) => void) => {
  void listener;
  return { remove: () => {} };
};
