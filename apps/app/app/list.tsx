import {
  booksWithTag,
  deletePlaylist,
  getPlaylist,
  type LibraryBook,
  listTags,
  movePlaylistItem,
  normalizeTag,
  playlistBooks,
  renamePlaylist,
  setPlaylistKeepFinished,
  setPlaylistRule,
  type SmartRule,
} from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hint } from '../src/a11y';
import { t } from '../src/i18n';
import { openPlayer } from '../src/navigation';
import { EmptyState } from '../src/components/Lori';
import { BookActions } from '../src/components/BookActions';
import { BookRow } from '../src/components/BookRow';
import { COLORS, Icon, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { Sheet } from '../src/components/Sheet';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { playBook, playList, useFollowedList, useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { TextButton } from '../src/components/TextButton';
import { Pill } from '../src/components/Pill';

const HOUR = 3_600_000;

/** One line for a smart list's rule, such as “Not started · under 3 h · on this phone”. */
function describeRule(rule: SmartRule): string {
  const parts = [
    rule.status === 'notStarted'
      ? t('Not started')
      : rule.status === 'inProgress'
        ? t('In progress')
        : rule.status === 'finished'
          ? t('Finished')
          : null,
    rule.kind === 'book' ? t('Books') : rule.kind === 'episode' ? t('Episodes') : null,
    rule.maxDurationMs !== undefined
      ? t('Up to {h} h', { h: Math.round(rule.maxDurationMs / HOUR) })
      : null,
    rule.offline ? t('Ready offline') : null,
    ...(rule.tags ?? []).map((t) => `# ${t}`),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : t('Everything in your library');
}

function Choice<T>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pill
            key={o.label}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            className={`rounded-full border px-3 py-1.5 ${on ? 'border-amber bg-amber' : 'border-line'}`}
          >
            <Text className={on ? 'text-ink' : 'text-soft'}>{o.label}</Text>
          </Pill>
        );
      })}
    </View>
  );
}

function RuleSheet({
  rule,
  onChange,
  onClose,
}: {
  rule: SmartRule;
  onChange: (rule: SmartRule) => void;
  onClose: () => void;
}) {
  const tags = useMemo(() => listTags(db, profileId).map((t) => t.tag), []);
  // Undefined clears a field.
  const set = (change: { [K in keyof SmartRule]?: SmartRule[K] | undefined }) => {
    const merged = Object.entries({ ...rule, ...change }).filter(([, v]) => v !== undefined);
    onChange(Object.fromEntries(merged) as SmartRule);
  };
  return (
    <Sheet visible title={t('What this list shows')} onClose={onClose}>
      <View className="gap-4 pb-2">
        <Choice
          value={rule.status}
          onChange={(status) => set({ status })}
          options={[
            { label: t('Any'), value: undefined },
            { label: t('Not started'), value: 'notStarted' as const },
            { label: t('In progress'), value: 'inProgress' as const },
            { label: t('Finished'), value: 'finished' as const },
          ]}
        />
        <Choice
          value={rule.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { label: t('Books and episodes'), value: undefined },
            { label: t('Books'), value: 'book' as const },
            { label: t('Episodes'), value: 'episode' as const },
          ]}
        />
        <Choice
          value={rule.maxDurationMs}
          onChange={(maxDurationMs) => set({ maxDurationMs })}
          options={[
            { label: t('Any length'), value: undefined },
            { label: t('Up to 1 h'), value: HOUR },
            { label: t('Up to 3 h'), value: 3 * HOUR },
            { label: t('Up to 10 h'), value: 10 * HOUR },
          ]}
        />
        <Choice
          value={rule.offline === true}
          onChange={(offline) => set({ offline: offline || undefined })}
          options={[
            { label: t('Streaming too'), value: false },
            { label: t('Ready offline only'), value: true },
          ]}
        />
        {tags.length > 0 && (
          <View className="flex-row flex-wrap gap-2">
            {tags.map((tag) => {
              const on = rule.tags?.includes(tag) ?? false;
              const next = on
                ? (rule.tags ?? []).filter((t) => t !== tag)
                : [...(rule.tags ?? []), tag];
              return (
                <Pill
                  key={tag}
                  onPress={() => set({ tags: next.length > 0 ? next : undefined })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  className={`rounded-full border px-3 py-1.5 ${on ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={on ? 'text-ink' : 'text-soft'}># {tag}</Text>
                </Pill>
              );
            })}
          </View>
        )}
        <TextButton text={t('Done')} onPress={onClose} className="self-end" />
      </View>
    </Sheet>
  );
}

/** A hand-made list, a smart list or all books with a tag. */
export default function ListScreen() {
  const params = useLocalSearchParams<{ id?: string; tag?: string; rename?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const [actionBook, setActionBook] = useState<LibraryBook | null>(null);
  const [editingRule, setEditingRule] = useState(false);
  const [name, setName] = useState<string | null>(null);

  // `version` is the signal to re-read the database.
  const list = useMemo(
    () => (params.id ? getPlaylist(db, profileId, params.id) : null),
    [params.id, version],
  );
  const tag = params.tag ? normalizeTag(params.tag) : null;
  const books = useMemo(
    () => (list ? playlistBooks(db, profileId, list) : tag ? booksWithTag(db, profileId, tag) : []),
    [list, tag, version],
  );

  const following = useFollowedList();
  const playingHere = following && list && following.list.id === list.id ? following : null;

  // A book tapped in a list plays the list from there (M112); a tag's books play on their own.
  const open = useCallback(
    async (book: LibraryBook) => {
      try {
        if (list) await playList(list.id, book.id);
        else await playBook(book.id);
        refresh();
        openPlayer(router);
      } catch (error) {
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
      }
    },
    [router, list, refresh],
  );

  const play = async () => {
    if (!list) return;
    try {
      const started = await playList(list.id);
      refresh();
      if (started) openPlayer(router);
      else
        showAlert(
          t('Nothing left to play'),
          t(
            'Everything in this list is finished. Turn on “Play finished ones too” to hear it again.',
          ),
        );
    } catch (error) {
      showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
    }
  };

  const toggleKeepFinished = () => {
    if (!list) return;
    setPlaylistKeepFinished(db, profileId, list.id, !list.keepFinished, Date.now());
    refresh();
  };

  const saveName = () => {
    if (list && name !== null) renamePlaylist(db, profileId, list.id, name, Date.now());
    setName(null);
    refresh();
  };

  const remove = () =>
    list &&
    showAlert(t('Delete “{name}”?', { name: list.name }), t('The books stay in your library.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: () => {
          deletePlaylist(db, profileId, list.id, Date.now());
          refresh();
          router.back();
        },
      },
    ]);

  const manual = list !== null && list.rule === null;
  const editing = name !== null || (params.rename === '1' && list?.name === 'New list');

  return (
    <View className="flex-1 bg-night" style={{ paddingTop: insets.top + 4 }}>
      <FlatList
        data={books}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="gap-2 px-4 pb-3">
            <View className="flex-row items-center justify-between">
              <View className="-ms-2">
                <IconButton
                  name="back"
                  label={t('Back')}
                  color={COLORS.soft}
                  onPress={() => router.back()}
                />
              </View>
              {list && (
                <IconButton
                  name="close"
                  label={t('Delete list')}
                  color={COLORS.muted}
                  onPress={remove}
                />
              )}
            </View>
            {list && editing ? (
              <TextInput
                value={name ?? list.name}
                onChangeText={setName}
                onSubmitEditing={saveName}
                onBlur={saveName}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                accessibilityLabel={t('List name')}
                className="border-b border-amber pb-1 text-3xl font-semibold text-paper"
              />
            ) : (
              <Pressable
                disabled={!list}
                onPress={() => setName(list?.name ?? '')}
                accessibilityRole={list ? 'button' : 'header'}
                {...hint(list ? t('Rename') : undefined)}
                className="min-h-12 justify-center"
              >
                <Text className="text-3xl font-semibold text-paper">
                  {list ? list.name : `# ${tag ?? ''}`}
                </Text>
              </Pressable>
            )}
            {list && books.length > 0 && (
              <View className="flex-row flex-wrap items-center gap-2 pt-1">
                <Pressable
                  onPress={() => void play()}
                  accessibilityRole="button"
                  {...hint(t('Plays the list from where it stands, one item after the other'))}
                  className="min-h-12 flex-row items-center gap-2 rounded-full bg-amber px-5 active:opacity-80"
                >
                  <Icon name="play" size={18} color={COLORS.ink} />
                  <Text className="font-semibold text-ink">{t('Play list')}</Text>
                </Pressable>
                <Pill
                  onPress={toggleKeepFinished}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: list.keepFinished }}
                  aria-checked={list.keepFinished}
                  className={`min-h-12 justify-center rounded-full border px-3 ${list.keepFinished ? 'border-amber' : 'border-line'}`}
                >
                  <Text className={list.keepFinished ? 'text-amber' : 'text-soft'}>
                    {t('Play finished ones too')}
                  </Text>
                </Pill>
              </View>
            )}
            {list?.rule ? (
              <Pressable
                onPress={() => setEditingRule(true)}
                accessibilityRole="button"
                className="min-h-12 flex-row items-center gap-2 self-start rounded-full border border-line px-3 active:bg-raised"
              >
                <Icon name="moon" size={16} color={COLORS.amber} />
                <Text className="text-sm text-soft">{describeRule(list.rule)}</Text>
              </Pressable>
            ) : (
              <Text className="text-sm text-muted">
                {books.length === 1 ? t('1 book') : t('{n} books', { n: books.length })}
                {manual ? t(' · hold a book for more') : ''}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={manual ? t('Nothing on this list yet.') : t('No books match yet.')}
            hint={
              manual
                ? t('In the Library, hold a book and choose “Add to a list…”.')
                : t('Lori will wait here until one does.')
            }
          />
        }
        renderItem={({ item, index }) => (
          <View className="flex-row items-center">
            <View className="flex-1">
              <BookRow book={item} onOpen={(b) => void open(b)} onLongPress={setActionBook} />
            </View>
            {playingHere &&
              (item.id === playingHere.playing || item.id === playingHere.next?.id) && (
                <Text className="pe-2 text-xs uppercase tracking-widest text-amber">
                  {item.id === playingHere.playing ? t('Playing') : t('Next')}
                </Text>
              )}
            {manual && list && (
              <View className="pe-2">
                <IconButton
                  name="up"
                  label={t('Move up')}
                  size={20}
                  color={index === 0 ? COLORS.line : COLORS.soft}
                  onPress={() => {
                    if (index === 0) return;
                    movePlaylistItem(db, profileId, list.id, item.id, index - 1, Date.now());
                    refresh();
                  }}
                />
              </View>
            )}
          </View>
        )}
      />
      {list?.rule && editingRule && (
        <RuleSheet
          rule={list.rule}
          onChange={(rule) => {
            setPlaylistRule(db, profileId, list.id, rule, Date.now());
            refresh();
          }}
          onClose={() => setEditingRule(false)}
        />
      )}
      <BookActions
        book={actionBook}
        {...(manual && list ? { listId: list.id } : {})}
        onClose={() => setActionBook(null)}
        onChanged={refresh}
      />
      <MiniPlayer />
    </View>
  );
}
