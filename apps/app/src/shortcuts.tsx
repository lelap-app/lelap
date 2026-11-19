import {
  addBookmark,
  chapterJump,
  deleteBookmark,
  getBook,
  getSettings,
  type KeyTarget,
  setSpeed,
  type Shortcut,
  SHORTCUTS,
  shortcutFor,
  stepSpeed,
  toBookPosition,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { type RefObject, useCallback, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { Sheet } from './components/Sheet';
import { UndoBar, type UndoNotice } from './components/UndoBar';
import { db, newId } from './db';
import { formatClock } from './format';
import { t } from './i18n';
import * as history from './history';
import * as audio from './platform/audio';
import { seekToBookPosition, useLibrary } from './player';
import { profileId } from './profile';

// Keyboard shortcuts for the web app. Android has its media keys through the media session.

const searchListeners = new Set<() => void>();
let searchWanted = false;
const listListeners = new Set<() => void>();

/** Lets the Search field take focus when `/` is pressed, also when it opens the tab. */
export function useSearchFocus(input: RefObject<{ focus: () => void } | null>): void {
  useEffect(() => {
    const focus = () => {
      searchWanted = false;
      input.current?.focus();
    };
    // A field that has just mounted waits for the screen it replaced to let go of focus.
    const timer = searchWanted ? setTimeout(focus, 150) : undefined;
    searchListeners.add(focus);
    return () => {
      clearTimeout(timer);
      searchListeners.delete(focus);
    };
  }, [input]);
}

/** Opens the list of shortcuts, as `?` does. */
export function showShortcuts(): void {
  for (const listener of listListeners) listener();
}

export const SHORTCUTS_SUPPORTED = Platform.OS === 'web';

const label = (action: Shortcut, skipSeconds: number): string => {
  switch (action) {
    case 'playPause':
      return t('Play or pause');
    case 'back':
      return t('Back {n} seconds', { n: skipSeconds });
    case 'forward':
      return t('Forward {n} seconds', { n: skipSeconds });
    case 'previousChapter':
      return t('Previous chapter');
    case 'nextChapter':
      return t('Next chapter');
    case 'slower':
      return t('Slower');
    case 'faster':
      return t('Faster');
    case 'bookmark':
      return t('Add bookmark');
    case 'zoom':
      return t('Zoom the position bar in or out, while it has focus');
    case 'home':
      return t('Home');
    case 'discover':
      return t('Discover');
    case 'search':
      return t('Search');
    case 'podcasts':
      return t('Podcasts');
    case 'library':
      return t('Library');
    case 'help':
      return t('Show these shortcuts');
  }
};

const targetOf = (element: Element | null): KeyTarget => {
  if (!(element instanceof HTMLElement)) return 'other';
  const tag = element.tagName;
  const type = element.getAttribute('type');
  const role = element.getAttribute('role');
  // Arrows move within these (and a pane's divider, M113), so they count as sliders here.
  if (
    [
      'slider',
      'tab',
      'listbox',
      'option',
      'radio',
      'menuitemradio',
      'combobox',
      'separator',
    ].includes(role ?? '') ||
    (tag === 'INPUT' && type === 'range')
  )
    return 'slider';
  if (
    element.isContentEditable ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(type ?? ''))
  )
    return 'text';
  if (
    tag === 'BUTTON' ||
    tag === 'A' ||
    tag === 'INPUT' ||
    ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'].includes(role ?? '')
  )
    return 'button';
  return 'other';
};

// Presses in quick succession wait for each other, so each one moves a step.
let speedChange = Promise.resolve();
function changeSpeed(faster: boolean): void {
  speedChange = speedChange.then(() => stepAudioSpeed(faster)).catch(() => {});
}

async function stepAudioSpeed(faster: boolean): Promise<void> {
  const state = await audio.getState();
  if (!state.bookId) return;
  const speed = stepSpeed(state.speed, faster);
  await audio.setSpeed(speed);
  setSpeed(db, profileId, state.bookId, speed, Date.now());
}

async function playPause(): Promise<void> {
  const state = await audio.getState();
  await history.playPause(state.playing);
}

/** The book playing and where in it, on the whole-book timeline. */
async function playingPlace() {
  const state = await audio.getState();
  if (!state.bookId || !state.fileLocation) return null;
  const detail = getBook(db, profileId, state.bookId);
  if (!detail) return null;
  const position = toBookPosition(detail.files, state.fileLocation, state.positionMs);
  return { state, detail, position };
}

async function jumpChapter(forward: boolean): Promise<void> {
  const place = await playingPlace();
  if (!place) return;
  const to = chapterJump(place.detail.chapters, place.position, forward);
  if (to !== null) await seekToBookPosition(place.detail.book.id, to, 'chapter');
}

/** Adds a bookmark where the book is; the notice it returns can take it back. */
async function bookmarkHere(refresh: () => void): Promise<UndoNotice | null> {
  const place = await playingPlace();
  if (!place?.state.fileLocation) return null;
  const id = addBookmark(db, profileId, newId, {
    bookId: place.detail.book.id,
    fileLocation: place.state.fileLocation,
    filePositionMs: place.state.positionMs,
    note: null,
    now: Date.now(),
  });
  refresh();
  return {
    text: t('Bookmark added at {time}', { time: formatClock(place.position) }),
    undo: () => {
      deleteBookmark(db, profileId, id, Date.now());
      refresh();
    },
  };
}

const TABS = {
  home: '/',
  discover: '/discover',
  podcasts: '/podcasts',
  library: '/library',
} as const;

/** Listens for shortcuts in the web app and shows their list on `?`. Renders nothing elsewhere. */
export function ShortcutsHost() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<UndoNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  // Renders again on the library's signal, so a new skip interval shows while the list is open.
  const { refresh } = useLibrary();

  useEffect(() => {
    if (!SHORTCUTS_SUPPORTED) return;
    const show = () => setOpen(true);
    listListeners.add(show);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const action = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: targetOf(document.activeElement),
      });
      if (!action) return;
      // A sheet or dialog keeps its keys; only `?` closes the list of shortcuts again.
      if (document.querySelector('[aria-modal="true"]') && action !== 'help') return;
      event.preventDefault();
      switch (action) {
        case 'playPause':
          void playPause();
          break;
        case 'back':
          void history.skip(false);
          break;
        case 'forward':
          void history.skip(true);
          break;
        case 'previousChapter':
        case 'nextChapter':
          void jumpChapter(action === 'nextChapter');
          break;
        case 'bookmark':
          void bookmarkHere(refresh).then((added) => added && setNotice(added));
          break;
        case 'home':
        case 'discover':
        case 'podcasts':
        case 'library':
          router.navigate(TABS[action]);
          break;
        case 'slower':
        case 'faster':
          changeSpeed(action === 'faster');
          break;
        case 'search':
          searchWanted = true;
          router.navigate('/search');
          // After the tab has switched, so a field already mounted can take focus.
          requestAnimationFrame(() => {
            for (const listener of searchListeners) listener();
          });
          break;
        case 'help':
          setOpen((was) => !was);
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      listListeners.delete(show);
      document.removeEventListener('keydown', onKey);
    };
  }, [router, refresh]);

  if (!SHORTCUTS_SUPPORTED) return null;
  const skipSeconds = getSettings(db, profileId).skipIntervalMs / 1000;
  return (
    <>
      <UndoBar notice={notice} onDone={clearNotice} />
      <Sheet visible={open} title={t('Keyboard shortcuts')} onClose={() => setOpen(false)}>
        <View accessibilityRole="list" className="pb-2">
          {SHORTCUTS.map(({ action, keys }) => (
            <View
              key={action}
              className="min-h-12 flex-row items-center justify-between gap-4 border-b border-line"
            >
              <Text className="flex-1 text-base text-paper">{label(action, skipSeconds)}</Text>
              <View className="flex-row gap-2">
                {keys.map((key) => (
                  <Text
                    key={key}
                    className="min-w-8 rounded-md border border-line bg-night px-2 py-1 text-center font-mono text-sm text-soft"
                  >
                    {key === 'Space' ? t('Space') : key}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      </Sheet>
    </>
  );
}
