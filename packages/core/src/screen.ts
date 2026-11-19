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

/**
 * A window at least this wide gets a third column (M113): a book's page between the list and the
 * player, so neither is stretched across a 1920 px screen.
 */
export const THREE_COLUMNS_MIN_WIDTH = 1400;

export type Columns = 1 | 2 | 3;

/** How many columns a window gets: one on phones, the list and the player, or a page between. */
export function columnsFor(width: number, height: number): Columns {
  if (!isWide(width, height)) return 1;
  return width >= THREE_COLUMNS_MIN_WIDTH ? 3 : 2;
}

/** The rail's width, kept out of the room the columns share. */
export const RAIL_WIDTH = 88;

/** The width of the line between two panes, which takes the drag. */
export const DIVIDER_WIDTH = 12;

/** How far a dragged divider can move each pane; the list keeps at least `list`. */
export const PANE_LIMITS = {
  player: { min: 300, max: 560 },
  detail: { min: 360, max: 760 },
  list: 320,
} as const;

/** Widths the listener dragged the dividers to on this device; null keeps the default. */
export type PaneChoice = { player: number | null; detail: number | null };

export type Pane = 'player' | 'detail';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A dragged width within the pane's limits, rounded to a whole point. */
export function clampPane(pane: Pane, width: number): number {
  return Math.round(clamp(width, PANE_LIMITS[pane].min, PANE_LIMITS[pane].max));
}

/**
 * The player's and the page's widths for a window: the listener's choice or the default, then
 * narrowed (the page first) until the list keeps its room. `detail` is 0 without a third column.
 */
export function paneWidths(
  width: number,
  columns: Columns,
  choice: PaneChoice,
): { player: number; detail: number } {
  if (columns === 1) return { player: 0, detail: 0 };
  const room = width - RAIL_WIDTH - DIVIDER_WIDTH * (columns - 1);
  let player = clampPane('player', choice.player ?? playerPaneWidth(width));
  let detail = columns === 3 ? clampPane('detail', choice.detail ?? (room - player) / 2) : 0;
  let over = PANE_LIMITS.list + player + detail - room;
  if (over > 0 && columns === 3) {
    const by = Math.min(over, detail - PANE_LIMITS.detail.min);
    detail -= by;
    over -= by;
  }
  if (over > 0) player = Math.max(PANE_LIMITS.player.min, player - over);
  return { player: Math.round(player), detail: Math.round(detail) };
}

/**
 * A foldable's hinge, as Android's Jetpack WindowManager reports it, in window points. A
 * `vertical` hinge splits the window left and right (a book), a `horizontal` one top and bottom.
 * `separating` is true when the screen is half open or the hinge hides part of it.
 */
export type Fold = {
  orientation: 'vertical' | 'horizontal';
  separating: boolean;
  /** The hinge's edges: x for a vertical hinge, y for a horizontal one. Equal for a seamless fold. */
  start: number;
  end: number;
};

/**
 * How the screens sit around a hinge: `book` puts the screens left of it and the player right of
 * it; `tabletop` the screens above and the player below, on the half that lies on the table.
 */
export type FoldLayout =
  { kind: 'none' } | { kind: 'book' | 'tabletop'; start: number; end: number };

/** Each side of a book fold needs this much width, and each half of a tabletop this much height. */
export const FOLD_MIN_SIDE = { book: 280, tabletop: 200 } as const;

/** Where the panes go around a fold, or `none` when the window is flat and seamless. */
export function foldLayout(fold: Fold | null, width: number, height: number): FoldLayout {
  if (!fold || !fold.separating || fold.end < fold.start) return { kind: 'none' };
  const kind = fold.orientation === 'vertical' ? 'book' : 'tabletop';
  const size = kind === 'book' ? width : height;
  // A hinge too near an edge leaves no room for one side: better one pane across it.
  if (fold.start < FOLD_MIN_SIDE[kind] || size - fold.end < FOLD_MIN_SIDE[kind]) {
    return { kind: 'none' };
  }
  return { kind, start: Math.round(fold.start), end: Math.round(fold.end) };
}

/** What can be dragged onto a list in the rail (M113): a book in the library or an episode. */
export type DragItem = { kind: 'book' | 'episode'; id: string };

/** The drag's data type, so a list only takes drags from Lelap itself. */
export const DRAG_TYPE = 'application/x-lelap-item';

export function writeDrag(item: DragItem): string {
  return JSON.stringify(item);
}

/** The dragged item, or null for anything else dropped on a list. */
export function readDrag(data: string): DragItem | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) return null;
    const { kind, id } = value as Record<string, unknown>;
    if ((kind !== 'book' && kind !== 'episode') || typeof id !== 'string' || !id) return null;
    return { kind, id };
  } catch {
    return null;
  }
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
  | 'zoom'
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
  // Taken by the position bar while it has focus, so it is not in `KEYS` (M105).
  { action: 'zoom', keys: ['Z'] },
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
