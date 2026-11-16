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
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookCover } from '../src/components/BookCover';
import { BookmarksSheet } from '../src/components/BookmarksSheet';
import { ChaptersSheet } from '../src/components/ChaptersSheet';
import { Sheet } from '../src/components/Sheet';
import { db, newId } from '../src/db';
import { formatClock, formatLeft } from '../src/format';
import * as audio from '../src/platform/audio';
import { seekToBookPosition, usePlayer } from '../src/player';
import { profileId } from '../src/profile';

const SPEEDS = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_MINUTES = [5, 15, 30, 45, 60];
// ⏮ goes to the start of the chapter, or to the previous one when pressed within this time.
const RESTART_WINDOW_MS = 3_000;

function Control({
  label,
  onPress,
  big = false,
}: {
  label: string;
  onPress: () => void;
  big?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className={`items-center justify-center rounded-full active:opacity-60 ${big ? 'h-20 w-20 bg-amber' : 'h-14 w-14'}`}
    >
      <Text className={big ? 'text-3xl text-ink' : 'text-base text-paper'}>{label}</Text>
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
  const { state, version, refresh } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<'chapters' | 'bookmarks' | 'speed' | 'sleep' | 'note' | null>(
    null,
  );
  const [width, setWidth] = useState(1);
  const [note, setNote] = useState('');
  const [lastBookmark, setLastBookmark] = useState<string | null>(null);

  const bookId = state.bookId;
  // `version` is the signal to re-read the database.
  const detail = useMemo(() => (bookId ? getBook(db, profileId, bookId) : null), [bookId, version]);
  const bookmarks = useMemo(
    () => (bookId ? listBookmarks(db, profileId, bookId) : []),
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

  return (
    <View
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
      className="flex-1 bg-night px-6"
    >
      <Pressable onPress={() => router.back()} hitSlop={12} className="self-start py-2">
        <Text className="text-2xl text-muted">⌄</Text>
      </Pressable>

      <View className="flex-1 items-center justify-center gap-5">
        <BookCover path={detail.book.coverPath} title={detail.book.title} size={260} />
        <View className="items-center gap-1">
          <Text numberOfLines={2} className="text-center text-xl font-semibold text-paper">
            {detail.book.title}
          </Text>
          {detail.book.author !== null && <Text className="text-soft">{detail.book.author}</Text>}
          {chapter && (
            <Pressable onPress={() => setSheet('chapters')}>
              <Text numberOfLines={1} className="text-center text-amber">
                {chapter.title}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <View className="gap-2">
        <Pressable
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => seek(rangeStart + (e.nativeEvent.locationX / width) * length)}
          className="h-8 justify-center"
        >
          <View className="h-1.5 overflow-hidden rounded-full bg-line">
            <View style={{ width: `${(elapsed / length) * 100}%` }} className="h-1.5 bg-amber" />
          </View>
        </Pressable>
        <View className="flex-row justify-between">
          <Text className="text-sm text-muted">{formatClock(elapsed)}</Text>
          <Text className="text-sm text-muted">{formatClock(length)}</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between py-4">
        <Control label="⟲30" onPress={() => void audio.skip(false)} />
        {chapters.length > 0 ? (
          <Control label="⏮" onPress={previousChapter} />
        ) : (
          <View className="w-14" />
        )}
        <Control
          big
          label={state.playing ? '❚❚' : '▶'}
          onPress={() => void (state.playing ? audio.pause() : audio.play())}
        />
        {chapters.length > 0 ? (
          <Control label="⏭" onPress={nextChapter} />
        ) : (
          <View className="w-14" />
        )}
        <Control label="30⟳" onPress={() => void audio.skip(true)} />
      </View>

      <View className="flex-row flex-wrap justify-center gap-2">
        <Chip label={`${Number(state.speed.toFixed(2))}×`} onPress={() => setSheet('speed')} />
        <Chip
          label={timer === null ? 'Sleep timer' : `Sleep ${formatClock(timer)}`}
          onPress={() => setSheet('sleep')}
        />
        <Chip label="+ Bookmark" onPress={bookmark} />
        <Chip
          label={`Bookmarks${bookmarks.length ? ` (${bookmarks.length})` : ''}`}
          onPress={() => setSheet('bookmarks')}
        />
        {chapters.length > 0 && <Chip label="Chapters" onPress={() => setSheet('chapters')} />}
      </View>

      {total > 0 && (
        <Text className="pt-3 text-center text-sm text-muted">
          {formatLeft((total - position) / Math.max(0.5, state.speed))} in book
        </Text>
      )}
      {state.waitingForCall && (
        <Text className="text-center text-sm text-amber">Starts when the call ends</Text>
      )}
      {state.error !== null && (
        <Text className="text-center text-sm text-danger">{state.error}</Text>
      )}

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
      </Sheet>
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
