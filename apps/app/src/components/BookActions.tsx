import {
  addToPlaylist,
  addToShelf,
  addToUpNext,
  createPlaylist,
  getTags,
  type LibraryBook,
  listPlaylists,
  listProfiles,
  listTags,
  normalizeTag,
  removeFromPlaylist,
  removeFromShelf,
  removeStreamedBook,
  setFinished,
  setTags,
  shelfBookIds,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { db, newId } from '../db';
import { showAlert } from '../dialog';
import { deleteDownload, startDownload } from '../downloads';
import { profileId } from '../profile';
import { COLORS, Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

type Mode = 'menu' | 'tags' | 'lists' | 'shelf';

function Row({
  icon,
  label,
  onPress,
  danger = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-line"
    >
      <Icon name={icon} size={22} color={danger ? COLORS.danger : COLORS.soft} />
      <Text className={danger ? 'text-danger' : 'text-paper'}>{label}</Text>
    </Pressable>
  );
}

/**
 * What can be done with a book from a list: finished, Up Next, download, tags, lists, removal.
 * `listId` adds “Remove from this list” for a hand-made list.
 */
export function BookActions({
  book,
  listId,
  onClose,
  onChanged,
}: {
  book: LibraryBook | null;
  listId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('menu');
  const [draft, setDraft] = useState('');
  const [tags, setTagsState] = useState<string[]>([]);

  useEffect(() => {
    setMode('menu');
    setDraft('');
    setTagsState(book ? getTags(db, profileId, book.id) : []);
  }, [book]);

  const known = useMemo(() => (book ? listTags(db, profileId).map((t) => t.tag) : []), [book]);
  // Grown-ups can put a book on a kids profile's shelf; kids can't change shelves.
  const kids = useMemo(() => {
    if (!book) return [];
    const all = listProfiles(db);
    if (all.find((p) => p.id === profileId)?.kids) return [];
    return all.filter((p) => p.kids);
  }, [book]);
  const [shelved, setShelved] = useState<Set<string>>(new Set());
  useEffect(() => {
    setShelved(
      new Set(kids.filter((k) => book && shelfBookIds(db, k.id).has(book.id)).map((k) => k.id)),
    );
  }, [book, kids]);
  const lists = useMemo(
    () => (book ? listPlaylists(db, profileId).filter((p) => p.rule === null) : []),
    [book],
  );

  if (!book) return null;
  const done = () => {
    onChanged();
    onClose();
  };
  const now = () => Date.now();

  const saveTags = (next: string[]) => {
    setTagsState(next);
    setTags(db, profileId, book.id, next, now());
    onChanged();
  };
  const addDraft = () => {
    const tag = normalizeTag(draft);
    if (tag && !tags.includes(tag)) saveTags([...tags, tag]);
    setDraft('');
  };

  const title =
    mode === 'tags'
      ? 'Tags'
      : mode === 'lists'
        ? 'Add to a list'
        : mode === 'shelf'
          ? 'Kids’ shelves'
          : book.title;

  return (
    <Sheet visible title={title} onClose={onClose}>
      {mode === 'menu' && (
        <ScrollView>
          <Row
            icon="check"
            label={book.finishedAt === null ? 'Mark as finished' : 'Mark as not finished'}
            onPress={() => {
              setFinished(db, profileId, book.id, book.finishedAt === null, now());
              done();
            }}
          />
          <Row
            icon="queue"
            label="Add to Up Next"
            onPress={() => {
              addToUpNext(db, profileId, book.id, 'last', now());
              done();
            }}
          />
          <Row icon="bookmark" label="Tags…" onPress={() => setMode('tags')} />
          <Row icon="chapters" label="Add to a list…" onPress={() => setMode('lists')} />
          {kids.length > 0 && (
            <Row icon="library" label="Put on a kid’s shelf…" onPress={() => setMode('shelf')} />
          )}
          {listId !== undefined && (
            <Row
              icon="close"
              label="Remove from this list"
              onPress={() => {
                removeFromPlaylist(db, profileId, listId, book.id, now());
                done();
              }}
            />
          )}
          {book.source === 'local' && (
            <Row
              icon="podcast"
              label="This is a podcast…"
              onPress={() => {
                onClose();
                router.push({ pathname: '/convert', params: { bookId: book.id } });
              }}
            />
          )}
          {book.source !== 'local' &&
            (book.downloaded ? (
              <Row
                icon="close"
                label="Remove download"
                onPress={() => {
                  void deleteDownload(book.id).finally(onChanged);
                  onClose();
                }}
              />
            ) : (
              <Row
                icon="download"
                label="Download"
                onPress={() => {
                  void startDownload(book.id, null)
                    .catch((error: unknown) =>
                      showAlert('Download', error instanceof Error ? error.message : String(error)),
                    )
                    .finally(onChanged);
                  onClose();
                }}
              />
            ))}
          {book.source === 'addon' && (
            <Row
              icon="close"
              label="Remove from library"
              danger
              onPress={() =>
                showAlert(
                  'Remove from library?',
                  'Your place and bookmarks in this book are removed too.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => {
                        removeStreamedBook(db, book.id);
                        // Its download, if any, goes too.
                        void deleteDownload(book.id).catch(() => {});
                        done();
                      },
                    },
                  ],
                )
              }
            />
          )}
        </ScrollView>
      )}

      {mode === 'tags' && (
        <View className="gap-3 pb-2">
          <View className="flex-row flex-wrap gap-2">
            {[...new Set([...tags, ...known])].map((tag) => {
              const on = tags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => saveTags(on ? tags.filter((t) => t !== tag) : [...tags, tag])}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  className={`rounded-full border px-3 py-1.5 ${on ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={on ? 'text-ink' : 'text-soft'}># {tag}</Text>
                </Pressable>
              );
            })}
          </View>
          <View className="flex-row gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={addDraft}
              placeholder="New tag"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              returnKeyType="done"
              className="flex-1 rounded-lg border border-line px-3 py-2 text-paper"
            />
            <Pressable
              onPress={addDraft}
              accessibilityRole="button"
              className="justify-center rounded-lg bg-amber px-4"
            >
              <Text className="font-semibold text-ink">Add</Text>
            </Pressable>
          </View>
          <Pressable onPress={onClose} className="self-end py-2">
            <Text className="text-amber">Done</Text>
          </Pressable>
        </View>
      )}

      {mode === 'shelf' && (
        <ScrollView>
          {kids.map((kid) => {
            const on = shelved.has(kid.id);
            return (
              <Row
                key={kid.id}
                icon={on ? 'check' : 'plus'}
                label={on ? `On ${kid.name}’s shelf` : `Put on ${kid.name}’s shelf`}
                onPress={() => {
                  if (on) removeFromShelf(db, kid.id, book.id, now());
                  else addToShelf(db, kid.id, book.id, now());
                  const next = new Set(shelved);
                  if (on) next.delete(kid.id);
                  else next.add(kid.id);
                  setShelved(next);
                  onChanged();
                }}
              />
            );
          })}
          <Text className="px-2 pb-3 pt-1 text-xs text-muted">
            A kids profile sees the books on its shelf, and streamed books it starts itself.
          </Text>
        </ScrollView>
      )}

      {mode === 'lists' && (
        <ScrollView>
          {lists.map((list) => (
            <Row
              key={list.id}
              icon="chapters"
              label={list.name}
              onPress={() => {
                addToPlaylist(db, profileId, list.id, book.id, now());
                done();
              }}
            />
          ))}
          <Row
            icon="plus"
            label="New list with this book"
            onPress={() => {
              const id = createPlaylist(
                db,
                profileId,
                newId,
                { name: 'New list', rule: null },
                now(),
              );
              addToPlaylist(db, profileId, id, book.id, now());
              onChanged();
              onClose();
              router.push({ pathname: '/list', params: { id, rename: '1' } });
            }}
          />
        </ScrollView>
      )}
    </Sheet>
  );
}
