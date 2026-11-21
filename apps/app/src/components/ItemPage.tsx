import {
  bookFraction,
  bookSourceChoice,
  chosenEdition,
  copyKey,
  downloadAllowed,
  downloadSnapshot,
  findBookBySource,
  findStreamedBook,
  findYourCopy,
  type FoundStream,
  getBook,
  getEditionChoice,
  findSeries,
  formatSeries,
  getSettings,
  getSourceChoice,
  knownTotal,
  orderStreams,
  streamPreferences,
  linkBook,
  type LinkableWork,
  pickSource,
  rejectLink,
  type SourceChoice,
  setEditionChoice,
  setSourceChoice,
  sourceLabel,
  withEdition,
} from '@lelap/core';
import { CONTENT_TYPES, type ContentType, type Edition, hasParts, type Meta } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { READABLE, useWide } from '../layout';
import { openPlayer } from '../navigation';
import { showAlert } from '../dialog';
import { PreparingPanel, showGone, streamState, usePreparing } from './Preparing';
import { Button } from './Button';
import { Icon } from './Icon';
import { LoadState } from './LoadState';
import { ScreenHeader } from './ScreenHeader';
import { addItem, playItem, queries, refreshItemSources, useAddons, useArtwork } from '../addons';
import { sourceCache } from '../availability';
import { BookCover, coverUri } from './BookCover';
import { badgeWords, keepShownRating, useBookBadges, useMetaBadges } from './CoverBadges';
import { DownloadButton } from './DownloadButton';
import { RatingRow } from './Rating';
import { db } from '../db';
import { startDownload } from '../downloads';
import { formatClock, formatDuration } from '../format';
import { languageName } from '../languageName';
import { playBook, useLibrary } from '../player';
import { profileId } from '../profile';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

const PARTS_SHOWN = 8;
const EDITIONS_SHOWN = 4;

/** The second line of an edition: who reads it, how long, which language. */
const editionDetails = (edition: Edition) =>
  [
    edition.narrators?.length
      ? t('Read by {names}', { names: edition.narrators.join(', ') })
      : null,
    edition.durationMs ? formatDuration(edition.durationMs) : null,
    edition.language ? languageName(edition.language) : null,
  ]
    .filter(Boolean)
    .join(' · ');

const isType = (value: string | undefined): value is ContentType =>
  (CONTENT_TYPES as readonly (string | undefined)[]).includes(value);

const seriesLabel = (series: Meta['series']) => {
  const main = series?.[0];
  return main
    ? main.position
      ? t('{series}, book {n}', { series: main.name, n: main.position })
      : main.name
    : null;
};

const streamLength = (found: FoundStream) =>
  hasParts(found.stream)
    ? knownTotal(found.stream.parts.map((p) => p.durationMs ?? 0))
    : (found.stream.durationMs ?? 0);

/** The second line of a release several add-ons have: each add-on, once. */
const copiesDetails = (copies: FoundStream[]) =>
  [...new Set(copies.map((c) => c.addon.manifest.name))].join(', ');

/** The second line of a source: which add-on, how long, how many parts. */
const sourceDetails = (found: FoundStream) => {
  const ms = streamLength(found);
  const count = hasParts(found.stream) ? found.stream.parts.length : 1;
  return [
    found.addon.manifest.name,
    found.stream.availability === 'preparing' ? t('Preparing') : null,
    ms > 0 ? formatDuration(ms) : null,
    count > 1 ? t('{n} parts', { n: count }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

const addonCount = (n: number) => (n === 1 ? t('1 add-on') : t('{n} add-ons', { n }));

/**
 * An add-on item's page: full screen, or the middle column on a very wide window (`column`, M113),
 * where Back closes the column.
 */
export function ItemPage({
  type: typeParam,
  id,
  onBack,
  column = false,
}: {
  type: string | undefined;
  id: string;
  onBack: () => void;
  column?: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const { version, refresh } = useLibrary();
  const type: ContentType = isType(typeParam) ? typeParam : 'audiobook';
  const addons = useAddons();
  const [picked, setPicked] = useState<SourceChoice | null>(null);
  const [allParts, setAllParts] = useState(false);
  const [allEditions, setAllEditions] = useState(false);
  const [starting, setStarting] = useState(false);
  // The listener's own copy plays unless they pick an add-on's source instead.
  const [ownPicked, setOwnPicked] = useState(true);

  const meta = useQuery(queries.meta(addons, type, id));
  // Its tiles show the rating this page shows (M102).
  useEffect(() => {
    if (meta.data) keepShownRating(meta.data.meta);
  }, [meta.data]);
  // The edition this profile chose (M66); the page shows it and asks for audio by its IDs too.
  // `version` is the signal to re-read the database.
  const editionKey = useMemo(() => getEditionChoice(db, profileId, type, id), [type, id, version]);
  const edition = chosenEdition(meta.data?.meta, editionKey);
  const work = meta.data ? withEdition(meta.data.meta, edition) : undefined;
  const chooseEdition = (key: string | null) => {
    setEditionChoice(db, profileId, type, id, key, Date.now());
    refresh();
  };
  // Wait for the meta: its external IDs reach add-ons that know the work by another ID.
  const sources = useQuery({
    ...queries.sources(addons, type, id, work?.externalIds),
    enabled: !meta.isPending,
  });

  // The listener's order across add-ons (M153), copies of one release as one row; `found` is
  // every copy in that order, so the first is what plays without a choice.
  const prefs = useMemo(() => streamPreferences(getSettings(db, profileId)), [version]);
  const rows = useMemo(() => orderStreams(sources.data?.found ?? [], prefs), [sources.data, prefs]);
  const found = useMemo(() => rows.flatMap((r) => r.copies), [rows]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  // A slow add-on's second look (`refreshAfter`, M152): once, while this page is open.
  const refreshAfter = sources.data?.refresh.length
    ? Math.min(...sources.data.refresh.map((r) => r.after))
    : null;
  // The timer keys on the query, not on objects that are new each render, so it isn't restarted.
  const refreshArgs = useRef({ addons, externalIds: work?.externalIds });
  refreshArgs.current = { addons, externalIds: work?.externalIds };
  const sourcesKey = JSON.stringify([type, id, work?.externalIds ?? {}, addons.map((a) => a.url)]);
  useEffect(() => {
    if (refreshAfter === null) return;
    const timer = setTimeout(() => {
      const { addons: now, externalIds } = refreshArgs.current;
      void refreshItemSources(now, type, id, externalIds);
    }, refreshAfter * 1000);
    return () => clearTimeout(timer);
  }, [refreshAfter, sourcesKey, type, id]);
  // What this page learned saves the cover badge a request of its own.
  useEffect(() => {
    const data = sources.data;
    if (!data) return;
    // The listener's first, not the add-ons': it may be one they hid.
    const first = found[0];
    if (first) sourceCache.set({ type, id }, { kind: 'stream', addon: first.addon.manifest.name });
    else if (data.failed.length === 0 && data.found.length === 0)
      sourceCache.set({ type, id }, { kind: 'none' });
  }, [sources.data, found, type, id]);
  // `version` is the signal to re-read the database.
  const remembered = useMemo(() => {
    const own = findStreamedBook(db, type, id);
    return [getSourceChoice(db, profileId, type, id), own ? bookSourceChoice(db, own) : null];
  }, [type, id, version]);
  const chosen = pickSource(found, [picked, ...remembered]);

  // The same book in the listener's own library, found on this device only (M56).
  // `version` is the signal to re-read the database.
  const linkable = useMemo((): LinkableWork | null => {
    const m = meta.data?.meta;
    if (!m) return null;
    const position = Number.parseFloat(m.series?.[0]?.position ?? '');
    return {
      type,
      id,
      title: m.name,
      author: m.author ?? null,
      externalIds: m.externalIds,
      series: Number.isInteger(position) ? position : null,
    };
  }, [meta.data, type, id]);
  // The same series in the library (M109), by name, for a link to its page.
  const seriesName = meta.data?.meta.series?.[0]?.name;
  const inLibrary = useMemo(
    () => (seriesName ? findSeries(db, profileId, seriesName, version) : null),
    [seriesName, version],
  );
  const yourCopy = useMemo(
    () => (linkable ? findYourCopy(db, linkable) : null),
    [linkable, version],
  );
  const own = yourCopy && yourCopy.how !== 'offer' ? yourCopy : null;
  const offer = yourCopy?.how === 'offer' ? yourCopy : null;
  const playingOwn = own !== null && ownPicked;
  const stream = playingOwn ? undefined : found[chosen];

  const choose = (f: FoundStream) => {
    const choice = { addonUrl: f.addon.url, sourceKey: f.stream.sourceKey };
    setOwnPicked(false);
    setPicked(choice);
    setSourceChoice(db, profileId, type, id, choice, Date.now());
  };
  const confirm = (yes: boolean) => {
    if (!linkable || !offer) return;
    // The work's series comes along; its title and cover don't, so the book keeps its own.
    if (yes) {
      const series = formatSeries(meta.data?.meta.series);
      linkBook(db, offer.bookId, linkable, Date.now(), null, series);
    } else rejectLink(db, offer.bookId, linkable, Date.now());
    setOwnPicked(true);
    refresh();
  };
  const unlink = () => {
    if (!linkable || !own) return;
    rejectLink(db, own.bookId, linkable, Date.now());
    refresh();
  };

  // The book in the library for the chosen recording, else for this item.
  // `version` is the signal to re-read the database.
  const sourceKey = stream?.stream.sourceKey;
  const ownId = playingOwn ? own.bookId : null;
  const saved = useMemo(() => {
    const bookId =
      ownId ??
      (sourceKey ? findBookBySource(db, sourceKey) : null) ??
      findStreamedBook(db, type, id);
    return bookId ? getBook(db, profileId, bookId) : null;
  }, [type, id, sourceKey, ownId, version]);
  // Offline, a downloaded book shows the metadata saved with its download.
  const snapshot = useMemo(() => (saved ? downloadSnapshot(db, saved.book.id) : null), [saved]);
  const item = work ?? snapshot ?? undefined;
  const artwork = useArtwork({
    id,
    type,
    cover: item?.cover ?? saved?.book.coverUrl ?? undefined,
  });
  const parts = stream && hasParts(stream.stream) ? stream.stream.parts : [];
  const sizeBytes = stream
    ? hasParts(stream.stream)
      ? stream.stream.parts.reduce((sum, p) => sum + (p.size ?? 0), 0)
      : (stream.stream.size ?? 0)
    : 0;
  // A live stream is never downloaded (M154).
  const canDownload = stream
    ? stream.stream.downloadable !== false && stream.stream.live !== true
    : saved?.book.source === 'addon' && downloadAllowed(db, saved.book.id);

  const download = async () => {
    const bookId = item && stream ? addItem(item, stream) : saved?.book.id;
    if (!bookId) return;
    // Lists kept for this library version (series, M115) see the added book.
    if (item && stream) refresh();
    await startDownload(bookId, work ?? null);
  };
  const progress = saved ? bookFraction(saved.book) : 0;

  // No place is saved while a stream prepares: nothing plays until it is ready (M152).
  const start = async (ready?: FoundStream) => {
    setStarting(true);
    try {
      const chosenStream = ready ?? stream;
      if (item && chosenStream) {
        // A copy on this device plays whatever the source says now.
        if (!ready && !saved?.book.downloaded) {
          const state = await streamState(chosenStream);
          if (state.state === 'preparing') return preparing.wait(chosenStream, state.seconds);
          if (state.state === 'gone') return showGone(state);
        }
        // The other copies of its row play if this one can't be opened (M155).
        const row = rows.find((r) => r.copies.includes(chosenStream));
        await playItem(item, chosenStream, row?.copies);
      } else if (saved) await playBook(saved.book.id);
      else return;
      refresh();
      openPlayer(router);
    } catch (error) {
      showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };
  const preparing = usePreparing((ready) => void start(ready));
  const play = () => start();
  // Download when ready: the download queue waits for the source on its own, with its rules.
  const downloadWhenReady = () => {
    preparing.cancel();
    void download();
  };

  const title = item?.name ?? saved?.book.title ?? '';
  const bookBadges = useBookBadges(saved?.book, 220, item?.badges);
  // Without a book of its own, the cover matches the library by title and author, as tiles do.
  const metaBadges = useMetaBadges(saved ? undefined : item, 220);
  const badges = saved ? bookBadges : metaBadges;
  const canPlay = (item !== undefined && stream !== undefined) || saved !== null;
  const looking = (meta.isPending || sources.isPending) && !saved;
  const noAudio = !saved && !own && sources.isSuccess && found.length === 0;
  const sourceCount = found.length + (own ? 1 : 0);
  const language = item?.language ? languageName(item.language) : null;
  const playLabel =
    saved && saved.book.finishedAt === null && progress > 0
      ? t('Continue · {percent} %', { percent: Math.min(99, Math.floor(progress * 100)) })
      : t('Play');

  return (
    <ScrollView
      className="flex-1 bg-night"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 24,
        ...(wide && !column ? READABLE : {}),
      }}
    >
      <View className="px-4">
        <ScreenHeader back={column ? 'close' : 'back'} onBack={onBack} />
      </View>

      <LoadState
        loading={meta.isPending && !saved}
        failed={
          !item &&
          !saved &&
          (meta.isError
            ? { title: t('This didn’t load'), body: t('Check the connection and try again.') }
            : { title: t('This item was not found.') })
        }
        onRetry={() => void meta.refetch()}
      >
        <View className="gap-5 px-4">
          <View className="items-center gap-3">
            {/* The cover is read only when it has badges, as one picture with them in its name. */}
            <View
              {...(badges.length > 0 && {
                accessible: true,
                accessibilityRole: 'image' as const,
                accessibilityLabel: t('Cover: {badges}', { badges: badgeWords(badges) }),
              })}
            >
              <BookCover
                uri={saved?.book.coverPath ? coverUri(saved.book) : artwork}
                title={title}
                size={220}
                badges={badges}
              />
            </View>
            <Text
              accessibilityRole="header"
              className="text-center text-2xl font-semibold text-paper"
            >
              {title}
            </Text>
            {(item?.author ?? saved?.book.author) && (
              <Text className="text-center text-base text-soft">
                {item?.author ?? saved?.book.author}
              </Text>
            )}
            <Text className="text-center text-sm text-muted">
              {[
                seriesLabel(item?.series),
                item?.narrators?.length
                  ? t('Read by {names}', { names: item.narrators.join(', ') })
                  : null,
                item?.durationMs ? formatDuration(item.durationMs) : null,
                item?.year ? String(item.year) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {inLibrary && (
              <TextButton
                text={
                  inLibrary.books.length === 1
                    ? t('1 book of {series} in your library', { series: inLibrary.name })
                    : t('{n} books of {series} in your library', {
                        n: inLibrary.books.length,
                        series: inLibrary.name,
                      })
                }
                onPress={() => router.push({ pathname: '/series', params: { key: inLibrary.key } })}
              />
            )}
          </View>

          {offer && (
            <View className="gap-3 rounded-2xl bg-raised p-4">
              <Text accessibilityRole="header" className="text-base font-semibold text-paper">
                {t('In your library?')}
              </Text>
              <Text className="text-sm leading-5 text-soft">
                {offer.author
                  ? t('“{title}” by {author} looks like this book.', {
                      title: offer.title,
                      author: offer.author,
                    })
                  : t('“{title}” looks like this book.', { title: offer.title })}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Button size="sm" text={t('Yes, use my copy')} onPress={() => confirm(true)} />
                <Button
                  size="sm"
                  kind="secondary"
                  text={t('Not this one')}
                  onPress={() => confirm(false)}
                />
              </View>
            </View>
          )}

          {noAudio ? (
            <NoAudio
              asked={sources.data?.asked.length ?? 0}
              failed={sources.data?.failed ?? []}
              onAddons={() => router.push('/addons')}
            />
          ) : sources.isError && !saved ? (
            <View className="items-center gap-2 rounded-2xl bg-raised p-4">
              <Text className="text-center text-soft">
                {t('Your add-ons did not answer. Check the connection and try again.')}
              </Text>
              <TextButton strong text={t('Try again')} onPress={() => void sources.refetch()} />
            </View>
          ) : (
            <Button
              text={looking ? t('Looking for audio…') : playLabel}
              onPress={() => void play()}
              disabled={!canPlay || preparing.waiting !== null}
              busy={starting}
            />
          )}
          {preparing.waiting && (
            <PreparingPanel
              secondsLeft={preparing.secondsLeft}
              canDownload={preparing.waiting.found.stream.downloadable !== false}
              onDownload={downloadWhenReady}
              onCancel={preparing.cancel}
            />
          )}
          {saved && (
            <Text className="-mt-3 text-center text-xs text-muted">
              {playingOwn
                ? t('Your copy, from your own library')
                : saved.book.downloaded
                  ? t('In your library · plays offline')
                  : t('In your library · streams while online')}
            </Text>
          )}
          {saved && <RatingRow key={saved.book.id} bookId={saved.book.id} profile={profileId} />}

          {canDownload && (
            <DownloadButton
              bookId={saved?.book.id ?? null}
              sizeBytes={sizeBytes}
              start={download}
            />
          )}

          {sourceCount > 0 && (
            <View className="gap-2">
              <Text
                accessibilityRole="header"
                className="text-xs uppercase tracking-wider text-muted"
              >
                {sourceCount === 1 ? t('Source') : t('{n} sources', { n: sourceCount })}
              </Text>
              {own && (
                <SourceRow
                  selected={playingOwn}
                  label={t('Your copy')}
                  details={[own.title, own.author].filter(Boolean).join(' · ')}
                  onPress={() => setOwnPicked(true)}
                />
              )}
              {rows.map((row) => {
                const key = copyKey(row.first);
                const picked = !playingOwn && stream !== undefined && row.copies.includes(stream);
                const open = openRow === key && row.copies.length > 1;
                return (
                  <View key={key} className="gap-2">
                    <SourceRow
                      selected={picked}
                      label={sourceLabel(picked && stream ? stream : row.first)}
                      details={
                        row.copies.length > 1 ? copiesDetails(row.copies) : sourceDetails(row.first)
                      }
                      onPress={() => choose(row.first)}
                    />
                    {row.copies.length > 1 && (
                      <TextButton
                        text={open ? t('Hide copies') : t('{n} copies', { n: row.copies.length })}
                        onPress={() => setOpenRow(open ? null : key)}
                        className="self-start ps-12"
                      />
                    )}
                    {open &&
                      row.copies.map((copy) => (
                        <View key={copyKey(copy)} className="ps-8">
                          <SourceRow
                            selected={!playingOwn && copy === stream}
                            label={sourceLabel(copy)}
                            details={sourceDetails(copy)}
                            onPress={() => choose(copy)}
                          />
                        </View>
                      ))}
                  </View>
                );
              })}
              {own && (
                <TextButton
                  text={t('Not your copy? Unlink')}
                  onPress={unlink}
                  className="self-start"
                />
              )}
              {(sources.data?.failed.length ?? 0) > 0 && (
                <Text accessibilityLiveRegion="polite" className="text-xs text-muted">
                  {t('{names} did not answer.', { names: sources.data?.failed.join(', ') ?? '' })}
                </Text>
              )}
            </View>
          )}

          {(meta.data?.meta.editions?.length ?? 0) > 1 && (
            <View className="gap-2">
              <Text
                accessibilityRole="header"
                className="text-xs uppercase tracking-wider text-muted"
              >
                {t('Editions')}
              </Text>
              <SourceRow
                selected={edition === null}
                label={t('Any edition')}
                details={t('As the catalog describes the book')}
                onPress={() => chooseEdition(null)}
              />
              {(meta.data?.meta.editions ?? [])
                // The chosen one shows even when it is further down the list.
                .filter((e, i) => allEditions || i < EDITIONS_SHOWN || e.key === edition?.key)
                .map((e) => (
                  <SourceRow
                    key={e.key}
                    selected={edition?.key === e.key}
                    label={e.name}
                    details={editionDetails(e)}
                    onPress={() => chooseEdition(e.key)}
                  />
                ))}
              {!allEditions && (meta.data?.meta.editions?.length ?? 0) > EDITIONS_SHOWN && (
                <TextButton
                  text={t('Show all {n}', { n: meta.data?.meta.editions?.length ?? 0 })}
                  onPress={() => setAllEditions(true)}
                  className="self-start"
                />
              )}
            </View>
          )}

          {item?.description && (
            <Text className="text-base leading-6 text-soft">{item.description}</Text>
          )}

          {parts.length > 1 && (
            <View className="gap-1">
              <Text
                accessibilityRole="header"
                className="pb-1 text-xs uppercase tracking-wider text-muted"
              >
                {t('{n} parts', { n: parts.length })}
              </Text>
              {(allParts ? parts : parts.slice(0, PARTS_SHOWN)).map((part, index) => (
                <View key={part.url} className="flex-row gap-3 border-b border-line py-2">
                  <Text className="w-6 text-right text-muted">{index + 1}</Text>
                  <Text numberOfLines={1} className="flex-1 text-paper">
                    {part.title ?? t('Part {n}', { n: index + 1 })}
                  </Text>
                  {part.durationMs !== undefined && (
                    <Text className="text-muted">{formatClock(part.durationMs)}</Text>
                  )}
                </View>
              ))}
              {!allParts && parts.length > PARTS_SHOWN && (
                <TextButton
                  text={t('Show all {n}', { n: parts.length })}
                  onPress={() => setAllParts(true)}
                />
              )}
            </View>
          )}

          {(language || item?.genres?.length) && (
            <View className="flex-row flex-wrap gap-2">
              {[language, ...(item?.genres ?? []).slice(0, 6)].filter(Boolean).map((tag) => (
                <Text
                  key={tag}
                  className="rounded-full border border-line px-3 py-1 text-xs text-soft"
                >
                  {tag}
                </Text>
              ))}
            </View>
          )}

          {(meta.data?.addon || item?.link) && (
            <View className="flex-row items-center justify-between gap-3">
              {meta.data?.addon && (
                <Text className="flex-1 text-xs text-muted">
                  {t('From {name}', { name: meta.data.addon.manifest.name })}
                </Text>
              )}
              {item?.link && (
                <Pressable
                  onPress={() => void Linking.openURL(item.link ?? '')}
                  accessibilityRole="link"
                  className="min-h-12 flex-row items-center gap-1"
                >
                  <Text className="text-sm text-amber">{t('More about this book')}</Text>
                  <Icon name="forward" size={16} color={colors.amber} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      </LoadState>
    </ScrollView>
  );
}

/** One source to pick: the listener's own copy or an add-on's recording. */
function SourceRow({
  selected,
  label,
  details,
  onPress,
}: {
  selected: boolean;
  label: string;
  details: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${selected ? 'border-amber bg-raised' : 'border-line'}`}
    >
      {selected ? (
        <Icon name="check" size={24} color={colors.amber} />
      ) : (
        <View className="m-[3px] h-[18px] w-[18px] rounded-full border-2 border-line" />
      )}
      <View className="flex-1">
        <Text numberOfLines={2} className={selected ? 'text-paper' : 'text-soft'}>
          {label}
        </Text>
        <Text numberOfLines={1} className="text-xs text-muted">
          {details}
        </Text>
      </View>
    </Pressable>
  );
}

/** The page for a work no installed add-on has audio for. */
function NoAudio({
  asked,
  failed,
  onAddons,
}: {
  asked: number;
  failed: string[];
  onAddons: () => void;
}) {
  const colors = useColors();
  const answered = asked - failed.length;
  return (
    <View className="items-center gap-2 rounded-2xl bg-raised px-4 py-5">
      <Icon name="cloud" size={28} color={colors.muted} />
      <Text className="text-center text-base font-semibold text-paper">
        {t('No audio for this book yet')}
      </Text>
      <Text className="text-center text-sm leading-5 text-soft">
        {asked === 0
          ? t('None of your add-ons has audio for books like this one.')
          : failed.length > 0
            ? t('Asked {addons}, {n} answered; none has a recording.', {
                addons: addonCount(asked),
                n: answered,
              })
            : t('Asked {addons}; none has a recording.', { addons: addonCount(asked) })}{' '}
        {t('An add-on that knows this work, such as one for your own server, can add it.')}
      </Text>
      <Pressable
        onPress={onAddons}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-1"
      >
        <Text className="font-semibold text-amber">{t('Manage add-ons')}</Text>
        <Icon name="forward" size={16} color={colors.amber} />
      </Pressable>
    </View>
  );
}
