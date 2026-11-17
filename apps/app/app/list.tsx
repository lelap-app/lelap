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
  setPlaylistRule,
  type SmartRule,
} from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookActions } from '../src/components/BookActions';
import { BookRow } from '../src/components/BookRow';
import { COLORS, Icon, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { Sheet } from '../src/components/Sheet';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { playBook, useLibrary } from '../src/player';
import { profileId } from '../src/profile';

const HOUR = 3_600_000;

/** One line for a smart list's rule, such as “Not started · under 3 h · on this phone”. */
function describeRule(rule: SmartRule): string {
  const parts = [
    rule.status === 'notStarted'
      ? 'Not started'
      : rule.status === 'inProgress'
        ? 'In progress'
        : rule.status === 'finished'
          ? 'Finished'
          : null,
    rule.kind === 'book' ? 'Books' : rule.kind === 'episode' ? 'Episodes' : null,
    rule.maxDurationMs !== undefined ? `Up to ${Math.round(rule.maxDurationMs / HOUR)} h` : null,
    rule.offline ? 'Ready offline' : null,
    ...(rule.tags ?? []).map((t) => `# ${t}`),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Everything in your library';
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
          <Pressable
            key={o.label}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            className={`rounded-full border px-3 py-1.5 ${on ? 'border-amber bg-amber' : 'border-line'}`}
          >
            <Text className={on ? 'text-ink' : 'text-soft'}>{o.label}</Text>
          </Pressable>
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
    <Sheet visible title="What this list shows" onClose={onClose}>
      <View className="gap-4 pb-2">
        <Choice
          value={rule.status}
          onChange={(status) => set({ status })}
          options={[
            { label: 'Any', value: undefined },
            { label: 'Not started', value: 'notStarted' as const },
            { label: 'In progress', value: 'inProgress' as const },
            { label: 'Finished', value: 'finished' as const },
          ]}
        />
        <Choice
          value={rule.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { label: 'Books and episodes', value: undefined },
            { label: 'Books', value: 'book' as const },
            { label: 'Episodes', value: 'episode' as const },
          ]}
        />
        <Choice
          value={rule.maxDurationMs}
          onChange={(maxDurationMs) => set({ maxDurationMs })}
          options={[
            { label: 'Any length', value: undefined },
            { label: 'Up to 1 h', value: HOUR },
            { label: 'Up to 3 h', value: 3 * HOUR },
            { label: 'Up to 10 h', value: 10 * HOUR },
          ]}
        />
        <Choice
          value={rule.offline === true}
          onChange={(offline) => set({ offline: offline || undefined })}
          options={[
            { label: 'Streaming too', value: false },
            { label: 'Ready offline only', value: true },
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
                <Pressable
                  key={tag}
                  onPress={() => set({ tags: next.length > 0 ? next : undefined })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  className={`rounded-full border px-3 py-1.5 ${on ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={on ? 'text-ink' : 'text-soft'}># {tag}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Pressable onPress={onClose} className="self-end py-2">
          <Text className="text-amber">Done</Text>
        </Pressable>
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

  const open = useCallback(
    async (book: LibraryBook) => {
      try {
        await playBook(book.id);
        router.push('/player');
      } catch (error) {
        showAlert('Cannot play', error instanceof Error ? error.message : String(error));
      }
    },
    [router],
  );

  const saveName = () => {
    if (list && name !== null) renamePlaylist(db, profileId, list.id, name, Date.now());
    setName(null);
    refresh();
  };

  const remove = () =>
    list &&
    showAlert(`Delete “${list.name}”?`, 'The books stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
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
              <View className="-ml-2">
                <IconButton
                  name="back"
                  label="Back"
                  color={COLORS.soft}
                  onPress={() => router.back()}
                />
              </View>
              {list && (
                <IconButton
                  name="close"
                  label="Delete list"
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
                className="border-b border-amber pb-1 text-3xl font-semibold text-paper"
              />
            ) : (
              <Pressable
                disabled={!list}
                onPress={() => setName(list?.name ?? '')}
                accessibilityHint={list ? 'Rename' : undefined}
              >
                <Text className="text-3xl font-semibold text-paper">
                  {list ? list.name : `# ${tag ?? ''}`}
                </Text>
              </Pressable>
            )}
            {list?.rule ? (
              <Pressable
                onPress={() => setEditingRule(true)}
                accessibilityRole="button"
                className="flex-row items-center gap-2 self-start rounded-full border border-line px-3 py-1.5 active:bg-raised"
              >
                <Icon name="moon" size={16} color={COLORS.amber} />
                <Text className="text-sm text-soft">{describeRule(list.rule)}</Text>
              </Pressable>
            ) : (
              <Text className="text-sm text-muted">
                {books.length === 1 ? '1 book' : `${books.length} books`}
                {manual ? ' · hold a book for more' : ''}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 pt-8 text-center text-muted">
            {manual
              ? 'Nothing here yet. In the Library, hold a book and choose “Add to a list…”.'
              : 'No books match yet.'}
          </Text>
        }
        renderItem={({ item, index }) => (
          <View className="flex-row items-center">
            <View className="flex-1">
              <BookRow book={item} onOpen={(b) => void open(b)} onLongPress={setActionBook} />
            </View>
            {manual && list && (
              <View className="pr-2">
                <IconButton
                  name="up"
                  label="Move up"
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
