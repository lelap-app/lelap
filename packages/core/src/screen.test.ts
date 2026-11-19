import { describe, expect, it } from 'vitest';

import {
  clampPane,
  columnsFor,
  DIVIDER_WIDTH,
  dragStarts,
  type Fold,
  foldLayout,
  insetsBeside,
  isWide,
  type KeyPress,
  PANE_LIMITS,
  paneWidths,
  playerPaneWidth,
  RAIL_WIDTH,
  readDrag,
  writeDrag,
  shortcutFor,
  sliderKey,
  stepSpeed,
  zoneAt,
} from './screen';

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: 'other',
  ...extra,
});

describe('isWide', () => {
  it('keeps phones on one pane, upright or sideways', () => {
    expect(isWide(412, 915)).toBe(false);
    expect(isWide(915, 412)).toBe(false);
  });

  it('gives tablets and laptops two panes', () => {
    expect(isWide(800, 1280)).toBe(true);
    expect(isWide(1280, 800)).toBe(true);
    expect(isWide(1440, 900)).toBe(true);
  });

  it('keeps a narrow browser window on one pane', () => {
    expect(isWide(600, 900)).toBe(false);
  });
});

describe('playerPaneWidth', () => {
  it('stays between 340 and 440 points', () => {
    expect(playerPaneWidth(800)).toBe(340);
    expect(playerPaneWidth(1100)).toBe(396);
    expect(playerPaneWidth(1920)).toBe(440);
  });
});

describe('stepSpeed', () => {
  it('moves one step', () => {
    expect(stepSpeed(1, true)).toBe(1.1);
    expect(stepSpeed(1.25, false)).toBe(1.1);
  });

  it('finds the nearest step from a speed between them', () => {
    expect(stepSpeed(1.3, true)).toBe(1.5);
    expect(stepSpeed(1.3, false)).toBe(1.25);
  });

  it('stops at the ends', () => {
    expect(stepSpeed(3, true)).toBe(3);
    expect(stepSpeed(0.8, false)).toBe(0.8);
  });

  it('never steps the wrong way from outside the steps', () => {
    expect(stepSpeed(0.5, false)).toBe(0.5);
    expect(stepSpeed(0.5, true)).toBe(0.8);
    expect(stepSpeed(3.5, true)).toBe(3.5);
  });
});

describe('shortcutFor', () => {
  it('maps the keys', () => {
    expect(shortcutFor(press(' '))).toBe('playPause');
    expect(shortcutFor(press('k'))).toBe('playPause');
    expect(shortcutFor(press('ArrowLeft'))).toBe('back');
    expect(shortcutFor(press('L'))).toBe('forward');
    expect(shortcutFor(press('<'))).toBe('slower');
    expect(shortcutFor(press('>'))).toBe('faster');
    expect(shortcutFor(press('/'))).toBe('search');
    expect(shortcutFor(press('?'))).toBe('help');
    expect(shortcutFor(press('p'))).toBe('previousChapter');
    expect(shortcutFor(press('N'))).toBe('nextChapter');
    expect(shortcutFor(press('b'))).toBe('bookmark');
    expect(shortcutFor(press('1'))).toBe('home');
    expect(shortcutFor(press('3'))).toBe('search');
    expect(shortcutFor(press('5'))).toBe('library');
    expect(shortcutFor(press('x'))).toBeNull();
  });

  it('leaves every key to a text field', () => {
    expect(shortcutFor(press('k', { target: 'text' }))).toBeNull();
    expect(shortcutFor(press('/', { target: 'text' }))).toBeNull();
  });

  it('leaves browser shortcuts alone', () => {
    expect(shortcutFor(press('l', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(press('ArrowLeft', { altKey: true }))).toBeNull();
    expect(shortcutFor(press('k', { metaKey: true }))).toBeNull();
  });

  it('lets a focused button take Space and a slider take the arrows', () => {
    expect(shortcutFor(press(' ', { target: 'button' }))).toBeNull();
    expect(shortcutFor(press('k', { target: 'button' }))).toBe('playPause');
    expect(shortcutFor(press('ArrowRight', { target: 'slider' }))).toBeNull();
    expect(shortcutFor(press(' ', { target: 'slider' }))).toBeNull();
    expect(shortcutFor(press('l', { target: 'slider' }))).toBe('forward');
  });
});

describe('sliderKey', () => {
  it('moves a step with the arrows and four with Page Up and Page Down', () => {
    expect(sliderKey('ArrowRight', 0.5, 0.05)).toBeCloseTo(0.55);
    expect(sliderKey('ArrowUp', 0.5, 0.05)).toBeCloseTo(0.55);
    expect(sliderKey('ArrowLeft', 0.5, 0.05)).toBeCloseTo(0.45);
    expect(sliderKey('ArrowDown', 0.5, 0.05)).toBeCloseTo(0.45);
    expect(sliderKey('PageUp', 0.5, 0.05)).toBeCloseTo(0.7);
    expect(sliderKey('PageDown', 0.5, 0.05)).toBeCloseTo(0.3);
  });

  it('goes to either end with Home and End, and stays within them', () => {
    expect(sliderKey('Home', 0.5, 0.05)).toBe(0);
    expect(sliderKey('End', 0.5, 0.05)).toBe(1);
    expect(sliderKey('ArrowRight', 0.98, 0.05)).toBe(1);
    expect(sliderKey('PageDown', 0.1, 0.05)).toBe(0);
  });

  it('leaves other keys alone', () => {
    expect(sliderKey(' ', 0.5, 0.05)).toBeNull();
    expect(sliderKey('k', 0.5, 0.05)).toBeNull();
  });
});

describe('columnsFor', () => {
  it('gives phones one column and laptops two', () => {
    expect(columnsFor(412, 915)).toBe(1);
    expect(columnsFor(768, 1024)).toBe(2);
    expect(columnsFor(1280, 800)).toBe(2);
  });

  it('adds a third column on very wide windows', () => {
    expect(columnsFor(1400, 900)).toBe(3);
    expect(columnsFor(1920, 1080)).toBe(3);
  });

  it('keeps a wide but short window on one', () => {
    expect(columnsFor(1920, 400)).toBe(1);
  });
});

describe('paneWidths', () => {
  const none = { player: null, detail: null };

  it('keeps the default player width with two columns', () => {
    expect(paneWidths(1280, 2, none)).toEqual({ player: playerPaneWidth(1280), detail: 0 });
    expect(paneWidths(768, 2, none).player).toBe(340);
  });

  it('shares the rest between the list and the page with three', () => {
    // 1920 − 88 for the rail − 24 for two dividers − 440 for the player: half for the page.
    expect(paneWidths(1920, 3, none)).toEqual({ player: 440, detail: 684 });
  });

  it('keeps a dragged width within the limits', () => {
    expect(paneWidths(1920, 3, { player: 9999, detail: 10 })).toEqual({
      player: PANE_LIMITS.player.max,
      detail: PANE_LIMITS.detail.min,
    });
  });

  it('narrows the page, then the player, to keep the list readable', () => {
    const { player, detail } = paneWidths(1400, 3, { player: 560, detail: 760 });
    expect(player).toBe(560);
    expect(detail).toBe(1400 - RAIL_WIDTH - 2 * DIVIDER_WIDTH - 560 - PANE_LIMITS.list);
    expect(paneWidths(768, 2, { player: 560, detail: null }).player).toBe(
      768 - RAIL_WIDTH - DIVIDER_WIDTH - PANE_LIMITS.list,
    );
    // Never narrower than the player's least, even if the list then has a little less.
    expect(paneWidths(720, 2, { player: 560, detail: null }).player).toBe(PANE_LIMITS.player.min);
  });

  it('has nothing beside a single column', () => {
    expect(paneWidths(400, 1, none)).toEqual({ player: 0, detail: 0 });
  });

  it('rounds a dragged width', () => {
    expect(clampPane('player', 401.6)).toBe(402);
  });
});

describe('foldLayout', () => {
  const fold = (f: Partial<Fold>): Fold => ({
    orientation: 'vertical',
    separating: true,
    start: 420,
    end: 420,
    ...f,
  });

  it('ignores a flat, seamless screen', () => {
    expect(foldLayout(null, 840, 900)).toEqual({ kind: 'none' });
    expect(foldLayout(fold({ separating: false }), 840, 900)).toEqual({ kind: 'none' });
  });

  it('splits a half-open book at the hinge', () => {
    expect(foldLayout(fold({ start: 419.6, end: 440.2 }), 860, 900)).toEqual({
      kind: 'book',
      start: 420,
      end: 440,
      width: 860,
      height: 900,
    });
  });

  it('puts the player below a horizontal hinge on a table', () => {
    expect(foldLayout(fold({ orientation: 'horizontal', start: 440, end: 440 }), 412, 880)).toEqual(
      { kind: 'tabletop', start: 440, end: 440, width: 412, height: 880 },
    );
  });

  it('lays out from the window measured with the hinge', () => {
    // React Native still has the folded window; the hinge came with the unfolded one.
    const ahead = fold({ start: 420, end: 440, window: { width: 860, height: 900 } });
    expect(foldLayout(ahead, 412, 900)).toEqual({
      kind: 'book',
      start: 420,
      end: 440,
      width: 860,
      height: 900,
    });
  });

  it('keeps one pane when a side would be too small', () => {
    expect(foldLayout(fold({ start: 200, end: 200 }), 860, 900)).toEqual({ kind: 'none' });
    expect(foldLayout(fold({ orientation: 'horizontal', start: 700, end: 700 }), 412, 880)).toEqual(
      { kind: 'none' },
    );
  });
});

describe('insetsBeside', () => {
  const insets = { top: 24, right: 0, bottom: 48, left: 0 };
  const sideways = { top: 24, right: 48, bottom: 0, left: 10 };
  const book = { kind: 'book', start: 420, end: 440, width: 860, height: 900 } as const;

  it("keeps the window's insets without a hinge", () => {
    expect(insetsBeside(insets, { kind: 'none' }, 'first')).toBe(insets);
  });

  it("leaves the navigation bar to the half below a tabletop's hinge", () => {
    const tabletop = { ...book, kind: 'tabletop' } as const;
    expect(insetsBeside(insets, tabletop, 'first')).toEqual({ ...insets, bottom: 0 });
    expect(insetsBeside(insets, tabletop, 'second')).toEqual({ ...insets, top: 0 });
  });

  it('gives each side of a book only its outer edges', () => {
    expect(insetsBeside(sideways, book, 'first')).toEqual({ ...sideways, right: 0 });
    expect(insetsBeside(sideways, book, 'second')).toEqual({ ...sideways, left: 0 });
    expect(insetsBeside(sideways, book, 'first', true)).toEqual({ ...sideways, left: 0 });
  });
});

describe('drag to a list', () => {
  it('reads back what it wrote', () => {
    expect(readDrag(writeDrag({ kind: 'episode', id: 'e1' }))).toEqual({
      kind: 'episode',
      id: 'e1',
    });
    expect(readDrag(writeDrag({ kind: 'work', type: 'audiobook', id: 'lv:1' }))).toEqual({
      kind: 'work',
      type: 'audiobook',
      id: 'lv:1',
    });
  });

  it('starts on Android after a short hold, before the menu', () => {
    expect(dragStarts(100, 20, 0)).toBe(false);
    expect(dragStarts(300, 2, 1)).toBe(false);
    expect(dragStarts(300, 0, 8)).toBe(true);
    expect(dragStarts(600, 0, 8)).toBe(false);
  });

  it('finds the list under the pointer', () => {
    const zones = [
      { key: 'a', x: 0, y: 100, width: 88, height: 60 },
      { key: 'b', x: 0, y: 160, width: 88, height: 60 },
    ];
    expect(zoneAt(zones, 40, 120)).toBe('a');
    expect(zoneAt(zones, 40, 160)).toBe('b');
    expect(zoneAt(zones, 200, 120)).toBeNull();
  });

  it('takes nothing else', () => {
    expect(readDrag('https://example.com')).toBeNull();
    expect(readDrag('{"kind":"file","id":"x"}')).toBeNull();
    expect(readDrag('{"kind":"book","id":""}')).toBeNull();
    expect(readDrag('null')).toBeNull();
    expect(readDrag('{"kind":"work","id":"x"}')).toBeNull();
  });
});
