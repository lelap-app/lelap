import {
  type CoverBadge,
  coverBadges,
  getSettings,
  type LibraryBook,
  type ListeningState,
  listeningLookup,
  listeningOf,
  type WorkRef,
} from '@lelap/core';
import type { Badges, MetaPreview } from '@lelap/sdk';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { db } from '../db';
import { t } from '../i18n';
import { useLibrary } from '../player';
import { profileId } from '../profile';

// One read of the setting and the library per library change, shared by every cover on screen.
let source: {
  key: string;
  on: boolean;
  listening: (work: WorkRef) => ListeningState | null;
} | null = null;

function badgeSource(version: number) {
  const key = `${profileId} ${version}`;
  if (source?.key !== key) {
    source = {
      key,
      on: getSettings(db, profileId).badgesOnCovers,
      listening: listeningLookup(db, profileId),
    };
  }
  return source;
}

/** Badges fit on a cover by its size: one on a list row's, two on a tile's, all on a large one. */
export const badgesFor = (size: number) => (size < 100 ? 1 : size < 200 ? 2 : 3);

/** The badges for a catalog item's cover: the add-on's data and this profile's own state. */
export function useMetaBadges(meta: MetaPreview, size: number): CoverBadge[] {
  const { version } = useLibrary();
  return useMemo(() => {
    const { on, listening } = badgeSource(version);
    if (!on) return [];
    const work: WorkRef = {
      type: meta.type,
      id: meta.id,
      name: meta.name,
      ...(meta.author ? { author: meta.author } : {}),
    };
    return coverBadges(meta.badges, listening(work), badgesFor(size));
  }, [version, meta, size]);
}

/**
 * The badges for a library book's cover, from its own state, with the add-on's data when the
 * screen has its meta.
 */
export function useBookBadges(
  book: LibraryBook | null | undefined,
  size: number,
  fromAddon?: Badges,
): CoverBadge[] {
  const { version } = useLibrary();
  return useMemo(() => {
    if (!badgeSource(version).on) return [];
    return coverBadges(fromAddon, book ? listeningOf(book) : null, badgesFor(size));
  }, [version, book, size, fromAddon]);
}

const stars = (value: number) => value.toFixed(1);

/** What a badge says to a screen reader, as part of the cover's or the row's name. */
function spoken(badge: CoverBadge): string {
  switch (badge.kind) {
    case 'finished':
      return t('Finished');
    case 'progress':
      return t('{n} % listened', { n: badge.percent });
    case 'new':
      return badge.count === 1 ? t('1 new episode') : t('{n} new episodes', { n: badge.count });
    case 'rating':
      return t('Rated {stars} of 5', { stars: stars(badge.stars) });
  }
}

/** The badges in words, joined for an accessibility label; empty when there are none. */
export function badgeWords(badges: CoverBadge[]): string {
  return badges.map(spoken).join(', ');
}

/** A name with the cover's badges after it, such as “Walden, Rated 4.5 of 5”. */
export function withBadges(parts: (string | null | undefined)[], badges: CoverBadge[]): string {
  return [...parts, badgeWords(badges)].filter(Boolean).join(', ');
}

function shown(badge: CoverBadge, large: boolean): string {
  switch (badge.kind) {
    case 'finished':
      return large ? t('✓ Finished') : '✓';
    case 'progress':
      return `${badge.percent} %`;
    case 'new':
      return t('{n} new', { n: badge.count > 99 ? '99+' : badge.count });
    case 'rating':
      return `★ ${stars(badge.stars)}`;
  }
}

/**
 * The badges along a cover's top edge, in one style everywhere: solid pills so the text keeps its
 * contrast on any picture, and a sign or word in each so none relies on colour. Hidden from
 * screen readers; the cover's row or label says them instead.
 */
export function CoverBadgeRow({ badges, size }: { badges: CoverBadge[]; size: number }) {
  if (badges.length === 0) return null;
  const large = size >= 160;
  return (
    <View
      aria-hidden
      pointerEvents="none"
      className="absolute inset-x-1 top-1 flex-row flex-wrap gap-1"
    >
      {badges.map((badge) => (
        <View
          key={badge.kind}
          className={`rounded-full px-1.5 py-px ${badge.kind === 'finished' ? 'bg-amber' : 'bg-night'}`}
        >
          <Text
            numberOfLines={1}
            // Covers keep their size at large font sizes; the full words are in the label.
            maxFontSizeMultiplier={1.5}
            className={`font-semibold ${large ? 'text-xs' : 'text-[10px]'} ${
              badge.kind === 'finished'
                ? 'text-ink'
                : badge.kind === 'rating'
                  ? 'text-amber'
                  : 'text-paper'
            }`}
          >
            {shown(badge, large)}
          </Text>
        </View>
      ))}
    </View>
  );
}
