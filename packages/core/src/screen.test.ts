import { describe, expect, it } from 'vitest';

import { isWide, type KeyPress, playerPaneWidth, shortcutFor, stepSpeed } from './screen';

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
