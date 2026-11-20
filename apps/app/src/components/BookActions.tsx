import {
  addToPlaylist,
  addToShelf,
  addToUpNext,
  bookLinks,
  createPlaylist,
  downloadAllowed,
  isLiveBook,
  getTags,
  hideBooks,
  isHidden,
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
  showInLibrary,
  unlinkBook,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import { db, newId } from '../db';
import { showAlert } from '../dialog';
import { deleteDownload, startDownload } from '../downloads';
import { profileId } from '../profile';
import { scrobblesFor, trackAbandoned, trackMarkedFinished } from '../scrobble';
import { Icon, type IconName } from './Icon';
import { RatingRow } from './Rating';
import { Sheet } from './Sheet';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

type Mode = 'menu' | 'tags' | 'lists' | 'shelf' | 'rating';

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
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-12 flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-line"
    >
      <Icon name={icon} size={22} color={danger ? colors.danger : colors.soft} />
      <Text className={danger ? 'text-danger' : 'text-paper'}>{label}</Text>
    </Pressable>
  );
}

/**
 * What can be done with a book from a list: finished, Up Next, download, tags, lists, hiding,
 * removal. `listId` adds “Remove from this list” for a hand-made list. `onHidden` hears of a
 * book just hidden, so the screen can offer Undo.
 */
export function BookActions({
  book,
  listId,
  onClose,
  onChanged,
  onHidden,
}: {
  book: LibraryBook | null;
  listId?: string;
  onClose: () => void;
  onChanged: () => void;
  onHidden?: (book: LibraryBook) => void;
}) {
  const colors = useColors();
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
  const linked = useMemo(() => (book ? bookLinks(db, book.id).length > 0 : false), [book]);
  const hidden = useMemo(() => (book ? isHidden(db, profileId, book.id) : false), [book]);
  // A source that forbids downloads gets no Download row rather than one that only says no.
  const downloadable = useMemo(() => (book ? downloadAllowed(db, book.id) : false), [book]);
  const live = useMemo(() => (book ? isLiveBook(db, book.id) : false), [book]);
  // Stop reading means something only to a tracker that hears about this book (M66).
  const tracked = useMemo(() => (book ? scrobblesFor(book.id, profileId) : false), [book]);

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
      ? t('Tags')
      : mode === 'rating'
        ? t('Your rating')
        : mode === 'lists'
          ? t('Add to a list')
          : mode === 'shelf'
            ? t('Kids’ shelves')
            : book.title;

  return (
    <Sheet visible title={title} onClose={onClose}>
      {mode === 'menu' && (
        <ScrollView>
          {/* A live stream has no end (M154). */}
          {!live && (
            <Row
              icon="check"
              label={book.finishedAt === null ? t('Mark as finished') : t('Mark as not finished')}
              onPress={() => {
                const finishing = book.finishedAt === null;
                setFinished(db, profileId, book.id, finishing, now());
                if (finishing) trackMarkedFinished(book.id, profileId);
                done();
              }}
            />
          )}
          {tracked && book.finishedAt === null && book.bookPositionMs > 0 && (
            <Row
              icon="close"
              label={t('Stop reading')}
              onPress={() => {
                trackAbandoned(book.id, profileId);
                showAlert(
                  t('Stop reading'),
                  t('Your reading trackers now show this book as not finished.'),
                );
                done();
              }}
            />
          )}
          <Row
            icon="queue"
            label={t('Add to Up Next')}
            onPress={() => {
              addToUpNext(db, profileId, book.id, 'last', now());
              done();
            }}
          />
          <Row icon="star" label={t('Rate…')} onPress={() => setMode('rating')} />
          <Row icon="bookmark" label={t('Tags…')} onPress={() => setMode('tags')} />
          <Row icon="chapters" label={t('Add to a list…')} onPress={() => setMode('lists')} />
          {kids.length > 0 && (
            <Row
              icon="library"
              label={t('Put on a kid’s shelf…')}
              onPress={() => setMode('shelf')}
            />
          )}
          {listId !== undefined && (
            <Row
              icon="close"
              label={t('Remove from this list')}
              onPress={() => {
                removeFromPlaylist(db, profileId, listId, book.id, now());
                done();
              }}
            />
          )}
          {book.source !== 'feed' &&
            (hidden ? (
              <Row
                icon="show"
                label={t('Show in library')}
                onPress={() => {
                  showInLibrary(db, profileId, [book.id], now());
                  done();
                }}
              />
            ) : (
              <Row
                icon="hide"
                label={t('Hide')}
                onPress={() => {
                  hideBooks(db, profileId, [book.id], now());
                  onHidden?.(book);
                  done();
                }}
              />
            ))}
          {book.source === 'local' && (
            <Row
              icon="search"
              label={t('Match with catalog…')}
              onPress={() => {
                onClose();
                router.push({ pathname: '/match', params: { bookId: book.id } });
              }}
            />
          )}
          {book.source === 'local' && linked && (
            <Row
              icon="close"
              label={t('Unlink from catalog')}
              onPress={() => {
                unlinkBook(db, book.id, now());
                done();
              }}
            />
          )}
          {book.source === 'local' && (
            <Row
              icon="podcast"
              label={t('This is a podcast…')}
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
                label={t('Remove download')}
                onPress={() => {
                  void deleteDownload(book.id).finally(onChanged);
                  onClose();
                }}
              />
            ) : downloadable ? (
              <Row
                icon="download"
                label={t('Download')}
                onPress={() => {
                  void startDownload(book.id, null)
                    .catch((error: unknown) =>
                      showAlert(
                        t('Download'),
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                    .finally(onChanged);
                  onClose();
                }}
              />
            ) : null)}
          {book.source === 'addon' && (
            <Row
              icon="close"
              label={t('Remove from library')}
              danger
              onPress={() =>
                showAlert(
                  t('Remove from library?'),
                  t('Your place and bookmarks in this book are removed too.'),
                  [
                    { text: t('Cancel'), style: 'cancel' },
                    {
                      text: t('Remove'),
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

      {mode === 'rating' && (
        <View className="gap-3 pb-2">
          <RatingRow bookId={book.id} profile={profileId} heading={false} />
          <TextButton text={t('Done')} onPress={done} className="self-end" />
        </View>
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
                  aria-checked={on}
                  className={`min-h-12 justify-center rounded-full border px-3 ${on ? 'border-amber bg-amber' : 'border-line'}`}
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
              placeholder={t('New tag')}
              accessibilityLabel={t('New tag')}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              returnKeyType="done"
              className="min-h-12 min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-paper"
            />
            <Pressable
              onPress={addDraft}
              accessibilityRole="button"
              className="justify-center rounded-lg bg-amber px-4"
            >
              <Text className="font-semibold text-ink">{t('Add')}</Text>
            </Pressable>
          </View>
          <TextButton text={t('Done')} onPress={onClose} className="self-end" />
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
                label={
                  on
                    ? t('On {name}’s shelf', { name: kid.name })
                    : t('Put on {name}’s shelf', { name: kid.name })
                }
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
            {t('A kids profile sees the books on its shelf, and streamed books it starts itself.')}
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
            label={t('New list with this book')}
            onPress={() => {
              const id = createPlaylist(
                db,
                profileId,
                newId,
                { name: t('New list'), rule: null },
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
