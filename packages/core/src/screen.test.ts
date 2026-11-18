import { describe, expect, it } from 'vitest';

import {
  isWide,
  type KeyPress,
  playerPaneWidth,
  shortcutFor,
  sliderKey,
  stepSpeed,
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
