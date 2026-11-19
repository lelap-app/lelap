import {
  type AccentId,
  ACCENTS,
  builtInTheme,
  carPalette,
  carTheme,
  type CarPalette,
  type CustomTheme,
  parseThemeFile,
  resolveTheme,
  rgbTriplet,
  type Settings,
  statsPalette,
  type StatsPalette,
  type Theme,
  THEME_FILE_MAX_BYTES,
  type ThemeChoice,
  themeToFile,
  TOKENS,
} from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';
import { vars } from 'nativewind';
import { type ReactNode, useSyncExternalStore } from 'react';
import { Appearance, Platform, useColorScheme, View } from 'react-native';

import { COLORS } from './components/Icon';
import { showAlert } from './dialog';
import { t } from './i18n';
import { readPickedText, shareText } from './platform/files';

// The look (M108). Classes such as `bg-night` read CSS variables, set here; icons and other
// colours outside a class read COLORS, changed in place. The screens are drawn again under a new
// key (`useThemeKey`), as for a new language, so nothing keeps an old colour.

type Look = Pick<Settings, 'theme' | 'accent' | 'customTheme'>;

let look: Look = { theme: 'night', accent: 'amber', customTheme: null };
let current: Theme = builtInTheme('night', 'amber');
let key = 'night';
const listeners = new Set<() => void>();

const variables = (theme: Theme): Record<string, string> => ({
  ...Object.fromEntries(TOKENS.map((t) => [`--color-${t}`, rgbTriplet(theme.colors[t])])),
  '--focus-width': theme.highContrast ? '4px' : '2px',
});

function apply(): void {
  const next = resolveTheme(
    look.theme,
    look.accent,
    look.customTheme,
    Appearance.getColorScheme() === 'light',
  );
  const nextKey = `${next.id}:${next.name ?? ''}:${next.dark}:${Object.values(next.colors).join('')}`;
  if (nextKey === key) return;
  current = next;
  key = nextKey;
  Object.assign(COLORS, next.colors);
  // A sheet or dialog on the web is drawn outside the app's root view, so the variables go on
  // the page itself.
  if (Platform.OS === 'web' && typeof document !== 'undefined')
    for (const [name, value] of Object.entries(variables(next)))
      document.documentElement.style.setProperty(name, value);
  // A profile loads while the root renders; telling the screens then would update them mid-render.
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}

/** Draws with a profile's look; called when a profile loads and when the setting changes. */
export function setLook(settings: Look): void {
  look = { theme: settings.theme, accent: settings.accent, customTheme: settings.customTheme };
  apply();
}

// “Follow the system” changes with the phone's light or dark.
Appearance.addChangeListener(() => {
  if (look.theme === 'system') apply();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = (): Theme => useSyncExternalStore(subscribe, () => current);

/** Changes with the colours: a key for whatever must be drawn again. */
export const useThemeKey = (): string => useSyncExternalStore(subscribe, () => key);

export const currentAccent = (): AccentId => look.accent;

/** Car mode: light by day and dark at night for glare, in the listener's accent (M74). */
export function useCarPalette(): { palette: CarPalette; theme: Theme } {
  const app = useTheme();
  const theme = carTheme(app, look.accent, useColorScheme() === 'light');
  return { palette: carPalette(theme), theme };
}

/** The listening stats follow the app's theme. */
export const useStatsPalette = (): StatsPalette => statsPalette(useTheme());

/** Sets the theme's variables for everything inside, on Android; the web has them on the page. */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.colors.night },
        Platform.OS === 'web' ? undefined : vars(variables(theme)),
      ]}
    >
      {children}
    </View>
  );
}

export const themeLabel = (choice: ThemeChoice, custom: CustomTheme | null): string =>
  ({
    system: t('Like the phone'),
    night: t('Night'),
    dusk: t('Dusk'),
    day: t('Day'),
    sepia: t('Sepia'),
    contrast: t('High contrast'),
    custom: custom?.name ?? t('From a file'),
  })[choice];

export const accentLabel = (accent: AccentId): string =>
  ({
    amber: t('Amber'),
    teal: t('Teal'),
    rose: t('Rose'),
    blue: t('Blue'),
    green: t('Green'),
    violet: t('Violet'),
  })[accent];

/** An accent in the shade the current theme draws it in. */
export const accentSwatch = (theme: Theme, accent: AccentId): string =>
  ACCENTS[accent][theme.highContrast ? 'contrast' : theme.dark ? 'dark' : 'light'];

/** Saves the colours on screen as a theme file, through the share sheet or a download. */
export async function exportTheme(): Promise<void> {
  const name =
    current.id === 'custom'
      ? (look.customTheme?.name ?? 'Lelap')
      : `${themeLabel(current.id, null)}, ${accentLabel(look.accent)}`;
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'theme';
  await shareText(
    `lelap-theme-${slug}.json`,
    `${JSON.stringify(themeToFile(current, name), null, 2)}\n`,
  );
}

/**
 * Reads a theme file the listener picks. A file that isn't one, or whose colours would be hard to
 * read somewhere in the app, is refused with the reasons; nothing changes then.
 */
export async function pickThemeFile(): Promise<CustomTheme | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/json', 'text/plain', '*/*'],
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  // Refused before it is read: a theme file is a few hundred bytes.
  const read =
    asset.size !== undefined && asset.size > THEME_FILE_MAX_BYTES
      ? parseThemeFile(' '.repeat(THEME_FILE_MAX_BYTES + 1))
      : parseThemeFile(await readPickedText(asset));
  if (read.ok) return read.theme;
  showAlert(
    t('Lelap can’t use this theme'),
    `${t('A theme file holds a name and colours, and each colour must be easy to read on the ones it sits on.')}\n\n${read.problems.slice(0, 6).join('\n')}`,
  );
  return null;
}
