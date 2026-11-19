import { z } from 'zod';

// Themes (M108): the app's colours, by role. The names are the night theme's, kept so every
// class in the app (`bg-night`, `text-paper`) stays as it is: `night` is the background and
// `paper` the main text, also on a light theme. This file has no imports but zod, so the app's
// accessibility check can load it with Node's type stripping.

export const TOKENS = [
  'night',
  'raised',
  'paper',
  'soft',
  'muted',
  'line',
  'amber',
  'ink',
  'danger',
  'ok',
] as const;
export type Token = (typeof TOKENS)[number];
export type ThemeColors = Record<Token, string>;

export type BuiltInTheme = {
  /** Light text on a dark background; decides the accent's shade and the status bar. */
  dark: boolean;
  /** Text at 7:1 (WCAG AAA), borders at 3:1, larger focus rings, no text over pictures. */
  highContrast: boolean;
  /** Every colour but the accent, which the listener picks. */
  colors: Omit<ThemeColors, 'amber'>;
};

export const THEMES = {
  night: {
    dark: true,
    highContrast: false,
    colors: {
      night: '#0d0e11',
      raised: '#17191e',
      paper: '#f4f1ea',
      soft: '#c9c5bc',
      muted: '#8d8a83',
      line: '#33353b',
      ink: '#1a1305',
      danger: '#ff8a7a',
      ok: '#6bd49a',
    },
  },
  dusk: {
    dark: true,
    highContrast: false,
    colors: {
      night: '#1b2030',
      raised: '#252b3d',
      paper: '#eef1f7',
      soft: '#c5cad6',
      muted: '#9ba2b3',
      line: '#3c4459',
      ink: '#141824',
      danger: '#ff9c8f',
      ok: '#7fdcaa',
    },
  },
  day: {
    dark: false,
    highContrast: false,
    colors: {
      night: '#f4f1ea',
      raised: '#e6e0d3',
      paper: '#1a1305',
      soft: '#4a463e',
      muted: '#5c574d',
      line: '#cfc7b6',
      ink: '#ffffff',
      danger: '#a3261b',
      ok: '#1d6b40',
    },
  },
  sepia: {
    dark: false,
    highContrast: false,
    colors: {
      night: '#efe3c8',
      raised: '#e3d4b2',
      paper: '#2e2214',
      soft: '#4d3e2b',
      muted: '#5e4e39',
      line: '#cbb994',
      ink: '#fff8ea',
      danger: '#9a2416',
      ok: '#2a5e2e',
    },
  },
  contrast: {
    dark: true,
    highContrast: true,
    colors: {
      night: '#000000',
      raised: '#0a0a0a',
      paper: '#ffffff',
      soft: '#f2f2f2',
      muted: '#d9d9d9',
      line: '#616161',
      ink: '#000000',
      danger: '#ffb3a8',
      ok: '#8ff0b8',
    },
  },
} as const satisfies Record<string, BuiltInTheme>;
export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/**
 * Accents from the profile tiles' colours (M9): a bright shade for dark themes and a deep one for
 * light themes, so either reads as text and carries text on it.
 */
export const ACCENTS = {
  amber: { dark: '#f5b041', light: '#7a4f00', contrast: '#ffc861' },
  teal: { dark: '#4fc4b6', light: '#11665d', contrast: '#6fe0d2' },
  rose: { dark: '#f292a6', light: '#9c2f4a', contrast: '#ffadbe' },
  blue: { dark: '#8ab0ff', light: '#2c4f9c', contrast: '#a8c6ff' },
  green: { dark: '#8bd17c', light: '#2a611f', contrast: '#a6e895' },
  violet: { dark: '#c3a3ff', light: '#6440a8', contrast: '#d6c0ff' },
} as const satisfies Record<string, { dark: string; light: string; contrast: string }>;
export type AccentId = keyof typeof ACCENTS;
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

/** What the listener chose: a built-in theme, the system's light or dark, or a file's. */
export const ThemeChoiceSchema = z.enum([
  'system',
  'night',
  'dusk',
  'day',
  'sepia',
  'contrast',
  'custom',
] as const satisfies readonly ('system' | ThemeId | 'custom')[]);
export type ThemeChoice = z.infer<typeof ThemeChoiceSchema>;
export const AccentChoiceSchema = z.enum([
  'amber',
  'teal',
  'rose',
  'blue',
  'green',
  'violet',
] as const satisfies readonly AccentId[]);

const HEX = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A colour is # and six hex digits')
  .transform((s) => s.toLowerCase());

/** The colours of a theme file, by names a person can read; `TOKENS` in the same order. */
const FILE_NAMES = {
  background: 'night',
  surface: 'raised',
  text: 'paper',
  secondary: 'soft',
  muted: 'muted',
  line: 'line',
  accent: 'amber',
  onAccent: 'ink',
  danger: 'danger',
  success: 'ok',
} as const satisfies Record<string, Token>;

/**
 * A theme as a file. Strict: only a name, light or dark, and colours, so a file can carry no
 * code, fonts or pictures, and an unknown key is refused rather than dropped.
 */
export const ThemeFileSchema = z
  .object({
    lelap: z.literal('theme'),
    version: z.literal(1),
    name: z.string().trim().min(1).max(40),
    dark: z.boolean(),
    // Optional, so files written before M117 still read. A file that sets it is held to the high
    // contrast rules: text at 7:1, borders at 3:1.
    highContrast: z.boolean().optional(),
    colors: z
      .object(
        Object.fromEntries(Object.keys(FILE_NAMES).map((k) => [k, HEX])) as Record<
          keyof typeof FILE_NAMES,
          typeof HEX
        >,
      )
      .strict(),
  })
  .strict();
export type ThemeFile = z.infer<typeof ThemeFileSchema>;

/** A theme read from a file, kept in the settings as it is. */
export type CustomTheme = {
  name: string;
  dark: boolean;
  highContrast?: boolean | undefined;
  colors: ThemeColors;
};
export const CustomThemeSchema = z
  .object({
    name: z.string().min(1).max(40),
    dark: z.boolean(),
    highContrast: z.boolean().optional(),
    colors: z.object(Object.fromEntries(TOKENS.map((t) => [t, HEX])) as Record<Token, typeof HEX>),
  })
  .strict();

/** The colours the app draws with right now. */
export type Theme = {
  /** `night`, `day`, … or `custom`; never `system`, which resolves to `day` or `night`. */
  id: ThemeId | 'custom';
  name?: string;
  dark: boolean;
  highContrast: boolean;
  colors: ThemeColors;
};

export function builtInTheme(id: ThemeId, accent: AccentId): Theme {
  const theme: BuiltInTheme = THEMES[id];
  return {
    id,
    dark: theme.dark,
    highContrast: theme.highContrast,
    colors: {
      ...theme.colors,
      amber: ACCENTS[accent][theme.highContrast ? 'contrast' : theme.dark ? 'dark' : 'light'],
    },
  };
}

/**
 * The theme to draw with. `system` is the day theme when the phone is light and the night theme
 * otherwise; `custom` without a stored theme falls back to night.
 */
export function resolveTheme(
  choice: ThemeChoice,
  accent: AccentId,
  custom: CustomTheme | null,
  systemLight: boolean,
): Theme {
  if (choice === 'custom') {
    if (custom) return { id: 'custom', ...custom, highContrast: custom.highContrast === true };
    return builtInTheme('night', accent);
  }
  if (choice === 'system') return builtInTheme(systemLight ? 'day' : 'night', accent);
  return builtInTheme(choice, accent);
}

// WCAG 2.1 contrast.
const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = rgb(hex).map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `fg` drawn at `alpha` over `bg`. */
export function blend(fg: string, bg: string, alpha: number): string {
  const back = rgb(bg);
  return (
    '#' +
    rgb(fg)
      .map((v, i) => Math.round(v * alpha + (back[i] ?? 0) * (1 - alpha)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** “r g b”, the form the app's CSS variables take so Tailwind can add an alpha. */
export const rgbTriplet = (hex: string): string => rgb(hex).join(' ');

/** Text colours, drawn on the background and on cards. */
const TEXT: Token[] = ['paper', 'soft', 'muted', 'amber', 'danger', 'ok'];

/** Every pair of colours the app draws one on the other, with the ratio it needs. */
export function themePairs(theme: Theme): [Token, Token, number][] {
  const text = theme.highContrast ? 7 : 4.5;
  return [
    ...TEXT.flatMap((fg): [Token, Token, number][] =>
      (['night', 'raised'] as const).map((bg) => [fg, bg, text]),
    ),
    // Buttons and chosen chips: text on the accent.
    ['ink', 'amber', 4.5],
    ['night', 'amber', 4.5],
    // A chosen row or a pressed one keeps its text readable on the line colour.
    ['paper', 'line', 4.5],
    ['soft', 'line', 4.5],
    // Icons and outlines of controls need 3:1 (WCAG 1.4.11); high contrast draws every border so.
    ['muted', 'line', 3],
    ...(theme.highContrast
      ? ([
          ['line', 'night', 3],
          ['line', 'raised', 3],
        ] as [Token, Token, number][])
      : []),
  ];
}

/** Car mode's colours (M74): the theme's, with a dimmer colour for buttons that can't be used. */
export type CarPalette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  secondary: string;
  accentText: string;
  track: string;
  progress: string;
  /** Text on the play button. */
  onAccent: string;
  accent: string;
  disabled: string;
};

/**
 * Car mode follows the phone's light or dark for glare: by day the day theme, at night the
 * listener's theme when it is dark and the night theme when it is not. The accent always follows.
 * High contrast stays as it is day and night: it is chosen for the eyes, not for the light.
 */
export function carTheme(theme: Theme, accent: AccentId, systemLight: boolean): Theme {
  if (theme.highContrast) return theme;
  if (systemLight) return theme.dark ? swapped(theme, 'day', accent) : theme;
  return theme.dark ? theme : swapped(theme, 'night', accent);
}

/**
 * The built-in theme car mode swaps to. A file theme keeps its own accent there: as it is when it
 * passes every pair on the swapped theme, else in the nearest lightness of the same hue that does
 * (a bright accent for a dark file can't be text on paper). Only when none passes does the
 * profile's accent stand in.
 */
function swapped(theme: Theme, id: 'day' | 'night', accent: AccentId): Theme {
  const base = builtInTheme(id, accent);
  if (theme.id !== 'custom') return base;
  const [h, sat, light] = hsl(theme.colors.amber);
  const steps = Array.from({ length: 101 }, (_, i) => i / 100).sort(
    (a, b) => Math.abs(a - light) - Math.abs(b - light),
  );
  const tried = new Set<string>();
  for (const l of [light, ...steps]) {
    const amber = l === light ? theme.colors.amber : fromHsl(h, sat, l);
    if (tried.has(amber)) continue;
    tried.add(amber);
    const own: Theme = { ...base, colors: { ...base.colors, amber } };
    if (themeProblems(own).length === 0) return own;
  }
  return base;
}

/** Hue (0–360), saturation and lightness (0–1). */
function hsl(hex: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round((v + m) * 255))
      .map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function carPalette(theme: Theme): CarPalette {
  const c = theme.colors;
  return {
    background: c.night,
    surface: c.raised,
    // On paper the line colour is too faint to outline a button; halfway to muted holds its shape.
    border: theme.dark ? c.line : blend(c.muted, c.night, 0.5),
    text: c.paper,
    secondary: c.soft,
    accentText: c.amber,
    track: c.line,
    progress: c.amber,
    accent: c.amber,
    onAccent: c.ink,
    // Inactive controls need no ratio (WCAG 1.4.3); halfway to the background reads as off.
    disabled: blend(c.muted, c.night, 0.6),
  };
}

/** The listening stats' colours (M87): the app's theme. */
export type StatsPalette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  secondary: string;
  /** Bars other than the current one: 3:1 or more on [surface]. */
  bar: string;
  /** The current day, week or month, and filled parts. */
  accent: string;
  /** Accent text that reads on [background] and [surface]. */
  accentText: string;
  /** Text on [accent]. */
  onAccent: string;
};

export function statsPalette(theme: Theme): StatsPalette {
  const c = theme.colors;
  return {
    background: c.night,
    surface: c.raised,
    border: c.line,
    text: c.paper,
    secondary: c.soft,
    bar: c.muted,
    accent: c.amber,
    accentText: c.amber,
    onAccent: c.ink,
  };
}

const PALETTE_PAIRS: [string, string, number][] = [
  ...['text', 'secondary', 'accentText'].flatMap((fg): [string, string, number][] =>
    ['background', 'surface'].map((bg) => [fg, bg, 4.5]),
  ),
  ['onAccent', 'accent', 4.5],
  ['progress', 'track', 3],
  ['bar', 'surface', 3],
];

/** Pairs of a theme below the ratio they need, in words for the listener and the checks. */
export function themeProblems(theme: Theme): string[] {
  const problems: string[] = [];
  for (const [fg, bg, min] of themePairs(theme)) {
    const ratio = contrast(theme.colors[fg], theme.colors[bg]);
    if (ratio < min)
      problems.push(`${fileName(fg)} on ${fileName(bg)} is ${ratio.toFixed(2)}:1, below ${min}:1`);
  }
  const palettes: [string, Record<string, string>][] = [
    ['car mode', carPalette(theme)],
    ['stats', statsPalette(theme)],
  ];
  for (const [name, p] of palettes) {
    for (const [fg, bg, min] of PALETTE_PAIRS) {
      const [f, b] = [p[fg], p[bg]];
      if (f === undefined || b === undefined) continue;
      const ratio = contrast(f, b);
      if (ratio < min)
        problems.push(`${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`);
    }
  }
  return problems;
}

const fileName = (token: Token): string =>
  Object.entries(FILE_NAMES).find(([, t]) => t === token)?.[0] ?? token;

export function themeToFile(theme: Theme, name: string): ThemeFile {
  return {
    lelap: 'theme',
    version: 1,
    name: name.trim().slice(0, 40) || 'Lelap',
    dark: theme.dark,
    ...(theme.highContrast ? { highContrast: true } : {}),
    colors: Object.fromEntries(
      Object.entries(FILE_NAMES).map(([key, token]) => [key, theme.colors[token]]),
    ) as ThemeFile['colors'],
  };
}

/** Theme files are a few hundred bytes; anything much larger is not one. */
export const THEME_FILE_MAX_BYTES = 4096;

export type ThemeImport = { ok: true; theme: CustomTheme } | { ok: false; problems: string[] };

/** Reads a theme file: its shape, then every colour pair the app draws. */
export function parseThemeFile(text: string): ThemeImport {
  if (text.length > THEME_FILE_MAX_BYTES) return { ok: false, problems: ['The file is too large'] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['The file is not JSON'] };
  }
  const parsed = ThemeFileSchema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      problems: parsed.error.issues.map((i) =>
        i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message,
      ),
    };
  const file = parsed.data;
  const colors = Object.fromEntries(
    Object.entries(FILE_NAMES).map(([key, token]) => [
      token,
      file.colors[key as keyof typeof FILE_NAMES],
    ]),
  ) as ThemeColors;
  const theme: CustomTheme = {
    name: file.name,
    dark: file.dark,
    ...(file.highContrast === true ? { highContrast: true } : {}),
    colors,
  };
  const problems = themeProblems({
    id: 'custom',
    ...theme,
    highContrast: file.highContrast === true,
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, theme };
}
