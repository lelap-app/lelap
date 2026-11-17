import { NativeModule, requireNativeModule } from 'expo';

declare class LelapTextModule extends NativeModule {
  setLines(language: string, lines: Record<string, string>): void;
}

const native = requireNativeModule<LelapTextModule>('LelapText');

/**
 * Hands native code (notifications, the widget, the Quick Settings tile, Android Auto) its lines in
 * the profile's language, English → translation. They are saved, so they last with the app closed.
 */
export const setNativeText = (language: string, lines: Record<string, string>): void =>
  native.setLines(language, lines);
