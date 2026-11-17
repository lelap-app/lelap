import {
  addBookmark,
  chapterAt,
  deleteBookmark,
  getBook,
  getSettings,
  listBookmarks,
  setBookmarkNote,
  setSpeed,
  SPEED_STEPS,
  toBookPosition,
  parseTime,
  removeFoundChapters,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { PressScale } from './Motion';
import { BookCover, coverUri } from './BookCover';
import { BookmarksSheet } from './BookmarksSheet';
import { CastSheet } from './CastSheet';
import { ChaptersSheet } from './ChaptersSheet';
import { COLORS, Icon, IconButton, type IconName } from './Icon';
import { Scrubber, type ScrubMark } from './Scrubber';
import { Sheet } from './Sheet';
import { soundActive, SoundSheet, useSoundSettings } from './SoundSheet';
import { CASTING_SUPPORTED, useCasting } from '../casting';
import { db, newId } from '../db';
import { HeadphoneBanner } from '../devices';
import { formatClock, formatLeft } from '../format';
import * as audio from '../platform/audio';
import { reloadBook, seekToBookPosition, useLibrary, usePlayerState } from '../player';
import { transcriptOf } from '../podcasting';
import { canFindChapters, findChapters, stopFindingChapters, useSilenceScans } from '../silences';
import { profileId } from '../profile';

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
  spoken,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  /** What a screen reader says when the short label alone is unclear, such as “Speed, 1.5×”. */
  spoken?: string;
}) {
  const color = active ? COLORS.amber : COLORS.soft;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      className="flex-1 items-center gap-1 rounded-xl py-2 active:bg-raised"
    >
      <Icon name={icon} size={22} color={color} />
      {/* Up to seven tools share the row: at large font sizes the label shrinks to fit whole. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{ color }}
        className="text-center text-xs font-semibold"
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** One full-width choice in the sleep timer sheet. */
function SleepOption({
  label,
  onPress,
  active = false,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      className={`flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:bg-line ${active ? 'bg-line' : ''}`}
    >
      <Icon
        name={muted ? 'close' : 'moon'}
        size={20}
        color={active ? COLORS.amber : muted ? COLORS.muted : COLORS.soft}
      />
      <Text
        className={`flex-1 text-base ${active ? 'text-amber' : muted ? 'text-muted' : 'text-paper'}`}
      >
        {label}
      </Text>
      {active && <Icon name="check" size={20} color={COLORS.amber} />}
    </Pressable>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-12 justify-center rounded-full border border-line px-4 active:bg-raised"
    >
      <Text className="text-soft">{label}</Text>
    </Pressable>
  );
}

/**
 * The player: the Player screen on a phone, or the pane beside the list on a wide screen
 * (`pane`). A phone turned sideways gets the cover beside the controls.
 */
export function PlayerView({ pane = false }: { pane?: boolean }) {
  const state = usePlayerState();
  const { version, refresh } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dims = useWindowDimensions();
  const landscape = !pane && dims.width > dims.height;
  const [sheet, setSheet] = useState<
    'chapters' | 'bookmarks' | 'speed' | 'sleep' | 'sound' | 'note' | 'cast' | 'jump' | null
  >(null);
  const sound = useSoundSettings();
  const casting = useCasting();
  const [note, setNote] = useState('');
  const [lastBookmark, setLastBookmark] = useState<string | null>(null);
  // The bar covers the chapter; a tap on the note under it switches to the whole book.
  const [wholeBook, setWholeBook] = useState(false);
  const [jumpText, setJumpText] = useState('');
  // While the playhead is dragged the page holds still, so moving up for fine scrubbing works.
  const [scrubbing, setScrubbing] = useState(false);
  // `version` is the signal to re-read the setting.
  const skipSeconds = useMemo(() => getSettings(db, profileId).skipIntervalMs / 1000, [version]);

  const bookId = state.bookId;
  // `version` is the signal to re-read the database.
  const detail = useMemo(() => (bookId ? getBook(db, profileId, bookId) : null), [bookId, version]);
  const bookmarks = useMemo(
    () => (bookId ? listBookmarks(db, profileId, bookId) : []),
    [bookId, version],
  );
  const scans = useSilenceScans();
  const canFind = useMemo(() => canFindChapters(detail), [detail]);
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
        <Text className="text-soft">{t('Nothing is playing.')}</Text>
        {/* Beside the list, Back would close the screen next to it instead. */}
        {!pane && <Chip label={t('Back to the library')} onPress={() => router.back()} />}
      </View>
    );
  }

  const { chapters } = detail;
  const total = detail.book.durationMs;
  const position = toBookPosition(detail.files, state.fileLocation ?? '', state.positionMs);
  const current = chapterAt(chapters, position);
  const chapter = chapters[current];
  const chapterStart = chapter?.startMs ?? 0;
  const chapterEnd = chapter ? (chapters[current + 1]?.startMs ?? total) : total;
  const book = wholeBook || !chapter;
  const rangeStart = book ? 0 : chapterStart;
  const rangeEnd = book ? total : chapterEnd;
  const length = Math.max(1, rangeEnd - rangeStart);
  const elapsed = Math.min(length, Math.max(0, position - rangeStart));
  const inRange = (at: number) => at >= rangeStart && at <= rangeEnd;
  const marks: ScrubMark[] = [
    ...(book && chapters.length > 1
      ? chapters.slice(1).map((c) => ({ atMs: c.startMs - rangeStart, kind: 'chapter' as const }))
      : []),
    ...bookmarks
      .filter((b) => inRange(b.bookPositionMs))
      .map((b) => ({ atMs: b.bookPositionMs - rangeStart, kind: 'bookmark' as const })),
  ];
  const jumpTarget = parseTime(jumpText);
  const jump = (bookPositionMs: number) => {
    seek(Math.min(Math.max(0, bookPositionMs), Math.max(0, total - 1_000)));
    setJumpText('');
    setSheet(null);
  };

  const seek = (bookPositionMs: number) => void seekToBookPosition(bookId, bookPositionMs);
  const previousChapter = () =>
    seek(
      position - chapterStart > RESTART_WINDOW_MS
        ? chapterStart
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
    state.sleepTimerMode === 'chapter'
      ? t('ch. ')
      : state.sleepTimerMode === 'episode'
        ? t('ep. ')
        : '';

  const left = total > 0 ? (total - position) / Math.max(0.5, state.speed) : 0;
  const percent = total > 0 ? Math.round((position / total) * 100) : 0;

  // Sideways, the cover fills the height beside the controls.
  const coverSize = landscape
    ? Math.max(120, Math.min(320, dims.height - insets.top - insets.bottom - 48))
    : pane
      ? 240
      : 280;

  const header = (
    <>
      <View className="flex-row items-center justify-between">
        {pane ? (
          // Beside the list there is nothing to close.
          <View className="w-12" />
        ) : (
          <IconButton
            name="down"
            label={t('Close player')}
            size={26}
            onPress={() => router.back()}
          />
        )}
        {chapters.length > 1 && (
          <Text className="flex-1 text-center text-xs uppercase tracking-widest text-muted">
            {t('Chapter {n} of {total}', { n: current + 1, total: chapters.length })}
          </Text>
        )}
        {Platform.OS === 'android' ? (
          <IconButton
            name="car"
            label={t('Car mode')}
            color={COLORS.soft}
            onPress={() => router.push('/car')}
          />
        ) : (
          <View className="w-12" />
        )}
      </View>
      <HeadphoneBanner className="mt-2" />
    </>
  );

  const cover = (
    <BookCover uri={coverUri(detail.book)} title={detail.book.title} size={coverSize} />
  );

  const details = (
    <>
      <View className={`flex-row items-center gap-3 ${landscape ? 'pb-1' : 'pb-4'}`}>
        <View className="flex-1 gap-1">
          <Text numberOfLines={2} className="text-xl font-semibold text-paper">
            {detail.book.title}
          </Text>
          {chapter ? (
            <Pressable
              onPress={() => setSheet('chapters')}
              accessibilityRole="button"
              accessibilityHint={t('Opens the chapters')}
              className="min-h-12 justify-center"
            >
              <Text numberOfLines={2} className="text-soft">
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
          accessibilityLabel={t('Add bookmark')}
          className="h-12 w-12 items-center justify-center rounded-full bg-raised active:opacity-70"
        >
          <Icon name="bookmarkAdd" size={22} />
        </Pressable>
      </View>

      <Scrubber
        onDragChange={setScrubbing}
        elapsedMs={elapsed}
        lengthMs={length}
        middle={
          total > 0
            ? book && chapter
              ? `${detail.book.source === 'feed' ? t('Whole episode') : t('Whole book')} · ${formatLeft(left)}`
              : `${detail.book.source === 'feed' ? t('Episode') : t('Book')} ${percent}% · ${formatLeft(left)}`
            : undefined
        }
        marks={marks}
        onSeek={(offset) => seek(rangeStart + offset)}
        onPressElapsed={() => setSheet('jump')}
        {...(chapter ? { onPressMiddle: () => setWholeBook((v) => !v) } : {})}
      />

      <View className={`flex-row items-center justify-between ${landscape ? 'py-1' : 'py-4'}`}>
        <Control
          icon="back30"
          label={t('Back {n} seconds', { n: skipSeconds })}
          onPress={() => void audio.skip(false)}
        />
        {chapters.length > 0 ? (
          <Control icon="previous" label={t('Previous chapter')} onPress={previousChapter} />
        ) : (
          <View className="w-14" />
        )}
        <PressScale
          onPress={() => void (state.playing ? audio.pause() : audio.play())}
          accessibilityRole="button"
          accessibilityLabel={state.playing ? t('Pause') : t('Play')}
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
          <Control icon="next" label={t('Next chapter')} onPress={nextChapter} />
        ) : (
          <View className="w-14" />
        )}
        <Control
          icon="forward30"
          label={t('Forward {n} seconds', { n: skipSeconds })}
          onPress={() => void audio.skip(true)}
        />
      </View>

      {state.waitingForCall && (
        <Text className="pb-2 text-center text-sm text-amber">
          {t('Starts when the call ends')}
        </Text>
      )}
      {state.error !== null && (
        <Text className="pb-2 text-center text-sm text-danger">{state.error}</Text>
      )}

      <View className="flex-row">
        <Tool
          icon="speed"
          label={`${Number(state.speed.toFixed(2))}×`}
          spoken={t('Speed, {speed}×', { speed: Number(state.speed.toFixed(2)) })}
          onPress={() => setSheet('speed')}
        />
        <Tool
          icon="sound"
          label={t('Sound')}
          active={soundActive(sound.settings)}
          onPress={() => setSheet('sound')}
        />
        <Tool
          icon="moon"
          label={timer === null ? t('Sleep') : `${timerPrefix}${formatClock(timer)}`}
          active={timer !== null}
          onPress={() => setSheet('sleep')}
        />
        {(chapters.length > 0 || canFind) && (
          <Tool icon="chapters" label={t('Chapters')} onPress={() => setSheet('chapters')} />
        )}
        {hasTranscript && (
          <Tool
            icon="transcript"
            label={t('Transcript')}
            onPress={() => router.push('/transcript')}
          />
        )}
        <Tool
          icon="bookmark"
          label={
            bookmarks.length === 1 ? t('1 bookmark') : t('{n} bookmarks', { n: bookmarks.length })
          }
          onPress={() => setSheet('bookmarks')}
        />
        {CASTING_SUPPORTED && (
          <Tool
            icon="cast"
            label={casting.device?.name ?? t('Cast')}
            active={casting.device !== null}
            onPress={() => setSheet('cast')}
          />
        )}
      </View>
    </>
  );

  return (
    // Scrolls only when large text no longer fits on the screen.
    <ScrollView
      scrollEnabled={!scrubbing}
      className="flex-1 bg-night"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 4,
        paddingBottom: insets.bottom + 12,
        paddingHorizontal: 24 + (landscape ? Math.max(insets.left, insets.right) : 0),
      }}
    >
      {landscape ? (
        <View className="flex-1 flex-row items-center gap-8">
          <View className="flex-1 items-center justify-center">{cover}</View>
          <View className="flex-1 justify-center">
            {header}
            {details}
          </View>
        </View>
      ) : (
        <>
          {header}
          <View className="min-h-48 flex-1 items-center justify-center py-4">{cover}</View>
          {details}
        </>
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
        silences={{
          found: detail.foundChapters,
          canFind,
          scan: scans.get(bookId),
          onFind: () => void findChapters(bookId),
          onStop: () => void stopFindingChapters(bookId),
          onRemove: () => {
            removeFoundChapters(db, bookId);
            refresh();
            void reloadBook(bookId, false).catch(() => {});
          },
        }}
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
      <Sheet visible={sheet === 'speed'} title={t('Speed')} onClose={() => setSheet(null)}>
        <View className="flex-row flex-wrap gap-2 pb-2">
          {SPEED_STEPS.map((s) => (
            <Chip key={s} label={`${s}×`} onPress={() => changeSpeed(s)} />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === 'sleep'} title={t('Sleep timer')} onClose={() => setSheet(null)}>
        {timer !== null && (
          <Text className="pb-3 text-amber">
            {state.sleepTimerMode === 'chapter'
              ? t('Stops at the end of this chapter, in {time}', { time: formatClock(timer) })
              : state.sleepTimerMode === 'episode'
                ? t('Stops at the end of this episode, in {time}', { time: formatClock(timer) })
                : t('Stops in {time}', { time: formatClock(timer) })}
          </Text>
        )}
        <View className="gap-1 pb-2">
          {SLEEP_MINUTES.map((m) => (
            <SleepOption
              key={m}
              label={t('{n} minutes', { n: m })}
              onPress={() => {
                void audio.startSleepTimer(m);
                setSheet(null);
              }}
            />
          ))}
          <SleepOption
            label={endMode === 'episode' ? t('End of episode') : t('End of chapter')}
            active={state.sleepTimerMode === endMode}
            onPress={() => {
              void audio.startSleepTimerAtEnd(endMode);
              setSheet(null);
            }}
          />
          {timer !== null && (
            <View className="mt-2 border-t border-line pt-2">
              <SleepOption
                label={t('Turn off')}
                muted
                onPress={() => {
                  void audio.cancelSleepTimer();
                  setSheet(null);
                }}
              />
            </View>
          )}
        </View>
        {Platform.OS === 'android' && (
          <Text className="pb-2 text-sm text-muted">
            {t('In the last five minutes, shake the phone for ten more.')}
          </Text>
        )}
      </Sheet>
      <Sheet visible={sheet === 'jump'} title={t('Jump to')} onClose={() => setSheet(null)}>
        <View className="gap-3 pb-2">
          <View className="flex-row flex-wrap gap-2">
            {[-5, -1, 1, 5].map((minutes) => (
              <Chip
                key={minutes}
                label={`${minutes > 0 ? '+' : '−'}${t('{n} min', { n: Math.abs(minutes) })}`}
                onPress={() => jump(position + minutes * 60_000)}
              />
            ))}
          </View>
          <Text className="text-sm text-muted">
            {detail.book.source === 'feed'
              ? t(
                  'Now at {time} in the episode. Type a time to go there, such as 2:14:30, 14:30 or 90 (minutes).',
                  { time: formatClock(position) },
                )
              : t(
                  'Now at {time} in the book. Type a time to go there, such as 2:14:30, 14:30 or 90 (minutes).',
                  { time: formatClock(position) },
                )}
          </Text>
          <View className="flex-row gap-2">
            <TextInput
              value={jumpText}
              onChangeText={setJumpText}
              onSubmitEditing={() => jumpTarget !== null && jump(jumpTarget)}
              placeholder="2:14:30"
              accessibilityLabel={t('Time to jump to')}
              placeholderTextColor="#8d8a83"
              keyboardType="numbers-and-punctuation"
              returnKeyType="go"
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-paper"
            />
            <Pressable
              disabled={jumpTarget === null}
              onPress={() => jumpTarget !== null && jump(jumpTarget)}
              accessibilityRole="button"
              className={`min-h-12 justify-center rounded-lg px-4 ${jumpTarget === null ? 'bg-line' : 'bg-amber'}`}
            >
              <Text className={jumpTarget === null ? 'text-muted' : 'font-semibold text-ink'}>
                {t('Go')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Sheet>
      <SoundSheet
        visible={sheet === 'sound'}
        settings={sound.settings}
        onChange={sound.set}
        onClose={() => setSheet(null)}
      />
      <Sheet visible={sheet === 'note'} title={t('Bookmark saved')} onClose={saveNote}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t('Add a note (optional)')}
          accessibilityLabel={t('Note')}
          placeholderTextColor="#8d8a83"
          autoFocus
          onSubmitEditing={saveNote}
          className="rounded-lg border border-line px-3 py-2 text-paper"
        />
        <View className="flex-row justify-end gap-2 py-3">
          <Chip label={t('Done')} onPress={saveNote} />
        </View>
      </Sheet>
    </ScrollView>
  );
}
