import type { CoverBadge } from '@lelap/core';
import { useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

import { CoverBadgeRow } from './CoverBadges';
import { FadeIn } from './Motion';
import { proxyBase } from '../config';

/** On the web, plain-http covers go through the proxy so an https page can show them. */
export function webSafe(url: string | null | undefined): string | null {
  if (!url) return null;
  if (Platform.OS === 'web' && url.startsWith('http:')) {
    return `${proxyBase}/cover?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** A `file://` URI for a cover saved on the phone, else the add-on's cover URL. */
export function coverUri(book: {
  coverPath: string | null;
  coverUrl?: string | null;
}): string | null {
  // Web downloads live in OPFS, which an <img> can't read; the cover URL works there.
  if (book.coverPath && Platform.OS !== 'web') return `file://${book.coverPath}`;
  return webSafe(book.coverUrl);
}

/**
 * The cover, or a tile with the title's first letter when there is none, with any badges drawn
 * on top. Hidden from screen readers: the title always stands next to it, and whoever draws the
 * cover puts the badges into the row's name (`withBadges`).
 */
export function BookCover({
  uri,
  title,
  size,
  badges = [],
}: {
  uri: string | null | undefined;
  title: string;
  size: number;
  badges?: CoverBadge[];
}) {
  const cover = <PlainCover uri={uri} title={title} size={size} />;
  if (badges.length === 0) return cover;
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      {cover}
      <CoverBadgeRow badges={badges} size={size} />
    </View>
  );
}

function PlainCover({
  uri,
  title,
  size,
}: {
  uri: string | null | undefined;
  title: string;
  size: number;
}) {
  if (uri) return <CoverImage uri={webSafe(uri) ?? uri} size={size} />;
  return (
    <View
      aria-hidden
      style={{ width: size, height: size }}
      className="items-center justify-center rounded-md bg-raised"
    >
      <Text style={{ fontSize: size / 2.5 }} className="font-semibold text-muted">
        {title.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

/** The cover fades in once loaded, over the same raised tile the letter cover uses. */
function CoverImage({ uri, size }: { uri: string; size: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View
      aria-hidden
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-md bg-raised"
    >
      <FadeIn show={loaded} lift={0} duration={180}>
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          style={{ width: size, height: size }}
        />
      </FadeIn>
    </View>
  );
}
