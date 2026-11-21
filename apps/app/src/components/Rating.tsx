import { getRating, setRating } from '@lelap/core';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { db } from '../db';
import { useLibrary } from '../player';
import { t } from '../i18n';
import { ratingAddonsFor, trackRated } from '../scrobble';
import { Icon } from './Icon';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

const STARS = [1, 2, 3, 4, 5] as const;

/** `4.5` as words: “4.5 of 5 stars”, or “Not rated”. */
export const ratingWords = (rating: number | null) =>
  rating === null ? t('Not rated') : t('{n} of 5 stars', { n: rating.toLocaleString() });

/**
 * The next rating after a tap on star `n`: that many stars, then half a star less, then none. So
 * every half step is two taps away at most, without a slider.
 */
export function nextRating(current: number | null, n: number): number | null {
  if (current === n) return n - 0.5;
  if (current === n - 0.5) return null;
  return n;
}

/**
 * The listener's own rating of a library book (M102): kept per profile, synced, and sent as `rate`
 * to the add-ons that take it.
 */
export function RatingRow({
  bookId,
  profile,
  heading = true,
}: {
  bookId: string;
  profile: string;
  /** Off where the sheet's title already says “Your rating”. */
  heading?: boolean;
}) {
  const colors = useColors();
  const { version } = useLibrary();
  const [rating, setShown] = useState(() => getRating(db, profile, bookId));
  // A rating from another device arrives with a sync, which changes `version`.
  useEffect(() => setShown(getRating(db, profile, bookId)), [bookId, profile, version]);
  const hearing = useMemo(() => ratingAddonsFor(bookId, profile), [bookId, profile]);
  const change = (next: number | null) => {
    if (!setRating(db, profile, bookId, next, Date.now())) return;
    setShown(next);
    trackRated(bookId, next, profile);
  };
  return (
    <View className="gap-1">
      {heading && (
        <Text
          accessibilityRole="header"
          className="text-caption uppercase tracking-wider text-muted"
        >
          {t('Your rating')}
        </Text>
      )}
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="flex-row" accessibilityLabel={ratingWords(rating)}>
          {STARS.map((n) => {
            const fill =
              rating === null || rating < n - 0.5 ? 'empty' : rating >= n ? 'full' : 'half';
            return (
              <Pressable
                key={n}
                onPress={() => change(nextRating(rating, n))}
                accessibilityRole="button"
                accessibilityLabel={t('{n} of 5 stars', { n })}
                accessibilityState={{ selected: rating === n }}
                accessibilityHint={t('Tap again for half a star less.')}
                hitSlop={4}
                className="h-12 w-11 items-center justify-center active:opacity-70"
              >
                <Icon
                  name="star"
                  size={28}
                  color={fill === 'empty' ? colors.muted : colors.amber}
                  value={fill}
                />
              </Pressable>
            );
          })}
        </View>
        {rating !== null && (
          <TextButton text={t('Remove rating')} tone="muted" onPress={() => change(null)} />
        )}
      </View>
      <Text accessibilityLiveRegion="polite" className="text-caption text-muted">
        {ratingWords(rating)}
        {hearing.length > 0
          ? ` · ${t('Ratings go to {names}.', { names: hearing.join(', ') })}`
          : ''}
      </Text>
    </View>
  );
}
