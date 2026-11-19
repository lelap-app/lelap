import {
  BOOK_SOUND_KEYS,
  type BookSoundKey,
  bookSound,
  chooseSound,
  getSettings,
  NO_OVERRIDES,
  setBookSound,
  setSetting,
} from '@lelap/core';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { t } from '../i18n';
import { db } from '../db';
import { formatDuration } from '../format';
import * as audio from '../platform/audio';
import { updateSound, useLibrary } from '../player';
import { profileId } from '../profile';
import { Sheet } from './Sheet';
import { TextButton, Toggle } from './TextButton';

/** Settings for every book: they suit this phone or the listener's ears, not a recording. */
export type DeviceSoundKey = 'volumeBoost' | 'mono';
export type SoundKey = DeviceSoundKey | BookSoundKey;

type SoundOption<K extends SoundKey> = { key: K; label: string; detail: string };

/** Voice boost, skip silence and even loudness: a default in Settings, and per book or show. */
export const bookSoundOptions = (): SoundOption<BookSoundKey>[] =>
  [
    {
      key: 'voiceEq',
      label: t('Voice boost'),
      detail: t(
        'Cuts rumble, lifts the consonants and evens out soft and loud words, so voices are easier to follow.',
      ),
    },
    {
      key: 'skipSilence',
      label: t('Skip silence'),
      detail: t('Shortens long pauses, so you finish sooner.'),
    },
    {
      key: 'evenLoudness',
      label: t('Even loudness'),
      detail: t('Plays every book and episode at about the same volume.'),
    },
  ] satisfies SoundOption<BookSoundKey>[];

export const deviceSoundOptions = (): SoundOption<DeviceSoundKey>[] => [
  {
    key: 'volumeBoost',
    label: t('Volume boost'),
    detail: t(
      'Louder, for quiet recordings and speakers. Loud parts are held back so they never distort.',
    ),
  },
  { key: 'mono', label: t('Mono'), detail: t('Both channels in each ear, for one earbud.') },
];

/** Every sound switch, as Settings → Listening shows them. */
export const soundOptions = (): SoundOption<SoundKey>[] => [
  ...bookSoundOptions(),
  ...deviceSoundOptions(),
];

/**
 * The listener's sound settings, and the loaded book's own choices over them, with setters that
 * also tell the player.
 */
export function useSound(bookId: string | null) {
  const { version, refresh } = useLibrary();
  const [changes, setChanges] = useState(0);
  // `version` and `changes` are the signals to re-read: a sync or a profile switch, or a switch here.
  const settings = useMemo(() => getSettings(db, profileId), [version, changes]);
  const book = useMemo(
    () => (bookId ? bookSound(db, profileId, bookId) : null),
    [bookId, version, changes],
  );
  const effective = chooseSound(book?.overrides, settings);
  const changed = () => {
    setChanges((n) => n + 1);
    void audio.setSettings(getSettings(db, profileId));
  };
  const set = (key: DeviceSoundKey, value: boolean) => {
    setSetting(db, profileId, key, value, Date.now());
    changed();
  };
  const setForBook = (change: Partial<Record<BookSoundKey, boolean | null>>) => {
    if (!bookId) return;
    setBookSound(db, profileId, bookId, change, Date.now());
    setChanges((n) => n + 1);
    void updateSound(bookId);
    // Up Next and the car's books carry the choice too; they are sent again on a refresh.
    refresh();
  };
  const active =
    settings.volumeBoost || settings.mono || bookSoundOptions().some((o) => effective[o.key]);
  return { settings, book, effective, active, set, setForBook };
}

export function SoundRow({
  label,
  detail,
  note,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  /** A second line under the detail, such as the time saved. */
  note?: string | null;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-4 border-b border-line py-4">
      <View className="flex-1 gap-1">
        <Text className="text-base text-paper">{label}</Text>
        <Text className="text-sm text-muted">{detail}</Text>
        {note ? <Text className="text-sm text-amber">{note}</Text> : null}
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

/** Listening time skip silence saved in the book, read again every few seconds while shown. */
function useSilenceSaved(bookId: string | null, visible: boolean, on: boolean): number {
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    setSaved(0);
    if (!bookId || !visible) return;
    let live = true;
    const read = () =>
      void audio
        .silenceSavedMs(bookId)
        .then((ms) => {
          if (live) setSaved(ms);
        })
        .catch(() => {});
    read();
    const timer = on ? setInterval(read, 5_000) : null;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [bookId, visible, on]);
  return saved;
}

const Heading = ({ text }: { text: string }) => (
  <Text accessibilityRole="header" className="pt-2 text-xs uppercase tracking-wider text-muted">
    {text}
  </Text>
);

/** The player's sound sheet: the book's (or show's) own choices, then those for every book. */
export function SoundSheet({
  visible,
  bookId,
  sound,
  onClose,
}: {
  visible: boolean;
  bookId: string | null;
  sound: ReturnType<typeof useSound>;
  onClose: () => void;
}) {
  const { book, effective, settings } = sound;
  const saved = useSilenceSaved(bookId, visible, effective.skipSilence);
  const show = book?.scope === 'show';
  const own = book !== null && BOOK_SOUND_KEYS.some((k) => book.overrides[k] !== null);
  // Under a minute reads as “0 min”, so the line waits for the first one.
  const savedLine =
    saved >= 60_000
      ? show
        ? t('{time} saved in this episode', { time: formatDuration(saved) })
        : t('{time} saved in this book', { time: formatDuration(saved) })
      : null;
  return (
    <Sheet visible={visible} title={t('Sound')} onClose={onClose}>
      <ScrollView>
        {book && (
          <>
            <Heading text={show ? t('For this show') : t('For this book')} />
            {bookSoundOptions().map((o) => (
              <SoundRow
                key={o.key}
                label={o.label}
                detail={o.detail}
                note={o.key === 'skipSilence' ? savedLine : null}
                value={effective[o.key]}
                onChange={(v) => sound.setForBook({ [o.key]: v })}
              />
            ))}
            {own && (
              <TextButton
                text={t('Use the defaults from Settings')}
                onPress={() => sound.setForBook(NO_OVERRIDES)}
                className="self-start"
              />
            )}
          </>
        )}
        <View className="pt-4">
          <Heading text={t('For every book')} />
        </View>
        {deviceSoundOptions().map((o) => (
          <SoundRow
            key={o.key}
            label={o.label}
            detail={o.detail}
            value={settings[o.key]}
            onChange={(v) => sound.set(o.key, v)}
          />
        ))}
        <Text className="py-4 text-sm text-muted">
          {Platform.OS === 'android'
            ? t('Sound effects play on this phone. Speakers you cast to play without them.')
            : t(
                'In the browser, skip silence works on MP3 files with a constant bitrate, such as LibriVox’s, and on M4B, Opus, Ogg and FLAC files the browser can decode. A file from a host that doesn’t let the browser read it plays without the effects.',
              )}
        </Text>
      </ScrollView>
    </Sheet>
  );
}
