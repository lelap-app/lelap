import {
  addBookmark,
  chapterAt,
  deleteBookmark,
  getBook,
  listBookmarks,
  setBookmarkNote,
  setSpeed,
  toBookPosition,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressScale } from '../src/components/Motion';
import { BookCover, coverUri } from '../src/components/BookCover';
import { BookmarksSheet } from '../src/components/BookmarksSheet';
import { CastSheet } from '../src/components/CastSheet';
import { ChaptersSheet } from '../src/components/ChaptersSheet';
import { COLORS, Icon, IconButton, type IconName } from '../src/components/Icon';
import { Scrubber } from '../src/components/Scrubber';
import { Sheet } from '../src/components/Sheet';
import { soundActive, SoundSheet, useSoundSettings } from '../src/components/SoundSheet';
import { CASTING_SUPPORTED, useCasting } from '../src/casting';
import { db, newId } from '../src/db';
import { formatClock, formatLeft } from '../src/format';
import * as audio from '../src/platform/audio';
import { seekToBookPosition, useLibrary, usePlayerState } from '../src/player';
import { transcriptOf } from '../src/podcasting';
import { profileId } from '../src/profile';

const SPEEDS = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_MINUTES = [5, 15, 30, 45, 60];
// ⏮ goes to the start of the chapter, or to the previous one when pressed within this time.
const RESTART_WINDOW_MS = 3_000;

function Control({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-14 w-14 items-center justify-center rounded-full active:bg-raised"
    >
      <Icon name={icon} size={icon === 'back30' || icon === 'forward30' ? 34 : 26} />
    </Pressable>
  );
}

/** Icon over a short label, as in the bottom row of the design sketch. */
function Tool({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const color = active ? COLORS.amber : COLORS.soft;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-1 items-center gap-1 rounded-xl py-2 active:bg-raised"
    >
      <Icon name={icon} size={22} color={color} />
      <Text numberOfLines={1} style={{ color }} className="text-xs font-semibold">
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full border border-line px-4 py-2 active:bg-raised"
    >
      <Text className="text-soft">{label}</Text>
    </Pressable>
  );
}

export default function Player() {
  const state = usePlayerState();
  const { version, refresh } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<
    'chapters' | 'bookmarks' | 'speed' | 'sleep' | 'sound' | 'note' | 'cast' | null
  >(null);
  const sound = useSoundSettings();
  const casting = useCasting();
  const [note, setNote] = useState('');
  const [lastBookmark, setLastBookmark] = useState<string | null>(null);

  const bookId = state.bookId;
  // `version` is the signal to re-read the database.
  const detail = useMemo(() => (bookId ? getBook(db, profileId, bookId) : null), [bookId, version]);
  const bookmarks = useMemo(
    () => (bookId ? listBookmarks(db, profileId, bookId) : []),
    [bookId, version],
  );
  const hasTranscript = useMemo(
    () => (bookId ? transcriptOf(bookId) !== null : false),
    [bookId, version],
  );

  if (!bookId || !detail) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 items-center justify-center gap-4 bg-night"
      >
        <Text className="text-soft">Nothing is playing.</Text>
        <Chip label="Back to the library" onPress={() => router.back()} />
      </View>
    );
  }

  const { chapters } = detail;
  const total = detail.book.durationMs;
  const position = toBookPosition(detail.files, state.fileLocation ?? '', state.positionMs);
  const current = chapterAt(chapters, position);
  const chapter = chapters[current];
  const rangeStart = chapter?.startMs ?? 0;
  const rangeEnd = chapter ? (chapters[current + 1]?.startMs ?? total) : total;
  const length = Math.max(1, rangeEnd - rangeStart);
  const elapsed = Math.min(length, Math.max(0, position - rangeStart));

  const seek = (bookPositionMs: number) => void seekToBookPosition(bookId, bookPositionMs);
  const previousChapter = () =>
    seek(
      position - rangeStart > RESTART_WINDOW_MS
        ? rangeStart
        : (chapters[current - 1]?.startMs ?? 0),
    );
  const nextChapter = () => {
    const next = chapters[current + 1];
    if (next) seek(next.startMs);
  };

  const changeSpeed = (speed: number) => {
    void audio.setSpeed(speed);
    setSpeed(db, profileId, bookId, speed, Date.now());
    setSheet(null);
  };

  const bookmark = () => {
    if (!state.fileLocation) return;
    const id = addBookmark(db, profileId, newId, {
      bookId,
      fileLocation: state.fileLocation,
      filePositionMs: state.positionMs,
      note: null,
      now: Date.now(),
    });
    setLastBookmark(id);
    setNote('');
    setSheet('note');
    refresh();
  };

  const saveNote = () => {
    if (lastBookmark) setBookmarkNote(db, profileId, lastBookmark, note, Date.now());
    setSheet(null);
    refresh();
  };

  const timer = state.sleepTimerRemainingMs;
  // Podcasts stop at the end of the episode, books at the end of the chapter (or file).
  const endMode = detail.book.source === 'feed' ? 'episode' : 'chapter';
  const timerPrefix =
    state.sleepTimerMode === 'chapter' ? 'ch. ' : state.sleepTimerMode === 'episode' ? 'ep. ' : '';

  const left = total > 0 ? (total - position) / Math.max(0.5, state.speed) : 0;
  const percent = total > 0 ? Math.round((position / total) * 100) : 0;

  return (
    <View
      style={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 12 }}
      className="flex-1 bg-night px-6"
    >
      <View className="flex-row items-center justify-between">
        <IconButton name="down" label="Close player" size={26} onPress={() => router.back()} />
        {chapters.length > 1 && (
          <Text className="text-xs uppercase tracking-widest text-muted">
            Chapter {current + 1} of {chapters.length}
          </Text>
        )}
        <View className="w-11" />
      </View>

      <View className="flex-1 items-center justify-center">
        <BookCover uri={coverUri(detail.book)} title={detail.book.title} size={280} />
      </View>

      <View className="flex-row items-center gap-3 pb-4">
        <View className="flex-1 gap-1">
          <Text numberOfLines={2} className="text-xl font-semibold text-paper">
            {detail.book.title}
          </Text>
          {chapter ? (
            <Pressable onPress={() => setSheet('chapters')}>
              <Text numberOfLines={1} className="text-soft">
                {chapter.title}
              </Text>
            </Pressable>
          ) : (
            detail.book.author !== null && <Text className="text-soft">{detail.book.author}</Text>
          )}
        </View>
        <Pressable
          onPress={bookmark}
          accessibilityRole="button"
          accessibilityLabel="Add bookmark"
          className="h-11 w-11 items-center justify-center rounded-full bg-raised active:opacity-70"
        >
          <Icon name="bookmarkAdd" size={22} />
        </Pressable>
      </View>

      <Scrubber
        elapsedMs={elapsed}
        lengthMs={length}
        middle={total > 0 ? `Book ${percent}% · ${formatLeft(left)}` : undefined}
        onSeek={(offset) => seek(rangeStart + offset)}
      />

      <View className="flex-row items-center justify-between py-4">
        <Control icon="back30" label="Back 30 seconds" onPress={() => void audio.skip(false)} />
        {chapters.length > 0 ? (
          <Control icon="previous" label="Previous chapter" onPress={previousChapter} />
        ) : (
          <View className="w-14" />
        )}
        <PressScale
          onPress={() => void (state.playing ? audio.pause() : audio.play())}
          accessibilityRole="button"
          accessibilityLabel={state.playing ? 'Pause' : 'Play'}
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: COLORS.amber,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={state.playing ? 'pause' : 'play'} size={32} color={COLORS.ink} />
        </PressScale>
        {chapters.length > 0 ? (
          <Control icon="next" label="Next chapter" onPress={nextChapter} />
        ) : (
          <View className="w-14" />
        )}
        <Control
          icon="forward30"
          label="Forward 30 seconds"
          onPress={() => void audio.skip(true)}
        />
      </View>

      {state.waitingForCall && (
        <Text className="pb-2 text-center text-sm text-amber">Starts when the call ends</Text>
      )}
      {state.error !== null && (
        <Text className="pb-2 text-center text-sm text-danger">{state.error}</Text>
      )}

      <View className="flex-row">
        <Tool
          icon="speed"
          label={`${Number(state.speed.toFixed(2))}×`}
          onPress={() => setSheet('speed')}
        />
        <Tool
          icon="sound"
          label="Sound"
          active={soundActive(sound.settings)}
          onPress={() => setSheet('sound')}
        />
        <Tool
          icon="moon"
          label={timer === null ? 'Sleep' : `${timerPrefix}${formatClock(timer)}`}
          active={timer !== null}
          onPress={() => setSheet('sleep')}
        />
        {chapters.length > 0 && (
          <Tool icon="chapters" label="Chapters" onPress={() => setSheet('chapters')} />
        )}
        {hasTranscript && (
          <Tool icon="transcript" label="Transcript" onPress={() => router.push('/transcript')} />
        )}
        <Tool
          icon="bookmark"
          label={bookmarks.length === 1 ? '1 bookmark' : `${bookmarks.length} bookmarks`}
          onPress={() => setSheet('bookmarks')}
        />
        {CASTING_SUPPORTED && (
          <Tool
            icon="cast"
            label={casting.device?.name ?? 'Cast'}
            active={casting.device !== null}
            onPress={() => setSheet('cast')}
          />
        )}
      </View>

      <ChaptersSheet
        visible={sheet === 'chapters'}
        chapters={chapters}
        current={current}
        onPick={(startMs) => {
          seek(startMs);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <BookmarksSheet
        visible={sheet === 'bookmarks'}
        bookmarks={bookmarks}
        onPick={(b) => {
          seek(b.bookPositionMs);
          setSheet(null);
        }}
        onDelete={(id) => {
          deleteBookmark(db, profileId, id);
          refresh();
        }}
        onClose={() => setSheet(null)}
      />
      <CastSheet visible={sheet === 'cast'} bookId={bookId} onClose={() => setSheet(null)} />
      <Sheet visible={sheet === 'speed'} title="Speed" onClose={() => setSheet(null)}>
        <View className="flex-row flex-wrap gap-2 pb-2">
          {SPEEDS.map((s) => (
            <Chip key={s} label={`${s}×`} onPress={() => changeSpeed(s)} />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === 'sleep'} title="Sleep timer" onClose={() => setSheet(null)}>
        <View className="flex-row flex-wrap gap-2 pb-2">
          {SLEEP_MINUTES.map((m) => (
            <Chip
              key={m}
              label={`${m} min`}
              onPress={() => {
                void audio.startSleepTimer(m);
                setSheet(null);
              }}
            />
          ))}
          <Chip
            label={endMode === 'episode' ? 'End of episode' : 'End of chapter'}
            onPress={() => {
              void audio.startSleepTimerAtEnd(endMode);
              setSheet(null);
            }}
          />
          {timer !== null && (
            <Chip
              label="Turn off"
              onPress={() => {
                void audio.cancelSleepTimer();
                setSheet(null);
              }}
            />
          )}
        </View>
        {Platform.OS === 'android' && (
          <Text className="pb-2 text-sm text-muted">
            In the last five minutes, shake the phone for ten more.
          </Text>
        )}
      </Sheet>
      <SoundSheet
        visible={sheet === 'sound'}
        settings={sound.settings}
        onChange={sound.set}
        onClose={() => setSheet(null)}
      />
      <Sheet visible={sheet === 'note'} title="Bookmark saved" onClose={saveNote}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note (optional)"
          placeholderTextColor="#8d8a83"
          autoFocus
          onSubmitEditing={saveNote}
          className="rounded-lg border border-line px-3 py-2 text-paper"
        />
        <View className="flex-row justify-end gap-2 py-3">
          <Chip label="Done" onPress={saveNote} />
        </View>
      </Sheet>
    </View>
  );
}
