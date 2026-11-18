// Wide screens and the web app's keyboard: which layout a window gets and what a key does.

/** A window at least this wide and this tall gets two panes; phones, even sideways, stay one. */
export const WIDE_MIN_WIDTH = 720;
export const WIDE_MIN_HEIGHT = 480;

export function isWide(width: number, height: number): boolean {
  return width >= WIDE_MIN_WIDTH && height >= WIDE_MIN_HEIGHT;
}

/** The player beside the list: about a third of the window, never cramped or sprawling. */
export function playerPaneWidth(width: number): number {
  return Math.round(Math.min(440, Math.max(340, width * 0.36)));
}

/** The speeds the player offers, slowest first. */
export const SPEED_STEPS = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/** The next speed up or down from `current`, which need not be one of the steps. */
export function stepSpeed(current: number, faster: boolean): number {
  const steps: readonly number[] = faster ? SPEED_STEPS : [...SPEED_STEPS].reverse();
  const next = steps.find((s) => (faster ? s > current + 0.001 : s < current - 0.001));
  // Past the last step (such as half speed from a seek), stay put rather than jump back.
  return next ?? current;
}

export type Shortcut =
  | 'playPause'
  | 'back'
  | 'forward'
  | 'previousChapter'
  | 'nextChapter'
  | 'slower'
  | 'faster'
  | 'bookmark'
  | 'home'
  | 'discover'
  | 'search'
  | 'podcasts'
  | 'library'
  | 'help';

/**
 * What has focus when the key goes down: text takes every key, a control its own. `slider`
 * covers everything arrows move within: sliders, tabs, option lists, radio groups.
 */
export type KeyTarget = 'text' | 'button' | 'slider' | 'other';

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: KeyTarget;
}

/** The shortcuts in the order the list shows them, with the keys that do each. */
export const SHORTCUTS: readonly { action: Shortcut; keys: readonly string[] }[] = [
  { action: 'playPause', keys: ['Space', 'K'] },
  { action: 'back', keys: ['←', 'J'] },
  { action: 'forward', keys: ['→', 'L'] },
  { action: 'previousChapter', keys: ['P'] },
  { action: 'nextChapter', keys: ['N'] },
  { action: 'slower', keys: ['<'] },
  { action: 'faster', keys: ['>'] },
  { action: 'bookmark', keys: ['B'] },
  { action: 'home', keys: ['1'] },
  { action: 'discover', keys: ['2'] },
  { action: 'search', keys: ['/', '3'] },
  { action: 'podcasts', keys: ['4'] },
  { action: 'library', keys: ['5'] },
  { action: 'help', keys: ['?'] },
];

const KEYS: Record<string, Shortcut> = {
  ' ': 'playPause',
  k: 'playPause',
  K: 'playPause',
  ArrowLeft: 'back',
  j: 'back',
  J: 'back',
  ArrowRight: 'forward',
  l: 'forward',
  L: 'forward',
  p: 'previousChapter',
  P: 'previousChapter',
  n: 'nextChapter',
  N: 'nextChapter',
  '<': 'slower',
  '>': 'faster',
  b: 'bookmark',
  B: 'bookmark',
  // The tabs in the order they show.
  '1': 'home',
  '2': 'discover',
  '3': 'search',
  '4': 'podcasts',
  '5': 'library',
  '/': 'search',
  '?': 'help',
};

/**
 * Where a key moves a focused slider, as a share of its range from 0 to 1, or null when the key
 * doesn't move it: arrows by a step, Page Up and Page Down by four, Home and End to either end.
 */
export function sliderKey(key: string, ratio: number, step: number): number | null {
  const steps: Record<string, number> = {
    ArrowRight: 1,
    ArrowUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageUp: 4,
    PageDown: -4,
  };
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  const by = steps[key];
  return by === undefined ? null : Math.min(1, Math.max(0, ratio + by * step));
}

/** The shortcut a key press asks for, or null when the key belongs to the page or the browser. */
export function shortcutFor(press: KeyPress): Shortcut | null {
  if (press.ctrlKey || press.metaKey || press.altKey || press.target === 'text') return null;
  const action = KEYS[press.key] ?? null;
  // Space presses a focused button; arrows (and Space) work a focused slider, tab or option list.
  if (press.target !== 'other' && press.key === ' ') return null;
  if (press.target === 'slider' && (press.key === 'ArrowLeft' || press.key === 'ArrowRight'))
    return null;
  return action;
}
