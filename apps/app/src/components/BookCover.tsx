import { type CoverBadge, localFileUri } from '@lelap/core';
import { useEffect, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

import { CoverBadgeRow } from './CoverBadges';
import { FadeIn } from './Motion';
import { proxyBase } from '../config';
import { OPFS_SCHEME, opfsImageUrl } from '../webCovers';

/** On the web, plain-http covers go through the proxy so an https page can show them. */
export function webSafe(url: string | null | undefined): string | null {
  if (!url) return null;
  if (Platform.OS === 'web' && url.startsWith('http:')) {
    return `${proxyBase}/cover?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** A `file://` or `content://` URI for a cover saved on the phone, else the add-on's cover URL. */
export function coverUri(book: {
  coverPath: string | null;
  coverUrl?: string | null;
}): string | null {
  if (book.coverPath && Platform.OS !== 'web') return localFileUri(book.coverPath);
  // The web keeps its saved covers in OPFS, which an <img> can't read: the cover URL first, and
  // a server folder's cover through a blob URL (see CoverImage).
  const url = webSafe(book.coverUrl);
  if (url || !book.coverPath) return url;
  return `${OPFS_SCHEME}${book.coverPath}`;
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
  const shown = useShownUri(uri ? (webSafe(uri) ?? uri) : null);
  // The image, or the bare tile while a cover is read from OPFS, as while an image loads.
  if (shown !== null) return <CoverImage uri={shown} size={size} />;
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

/**
 * An address an <Image> can show: a cover kept in OPFS becomes a blob URL once it is read.
 * Undefined while it is read; null for no cover, or one gone from OPFS (the letter shows then).
 */
function useShownUri(uri: string | null): string | null | undefined {
  const opfsPath = uri?.startsWith(OPFS_SCHEME) ? uri.slice(OPFS_SCHEME.length) : null;
  const [blob, setBlob] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!opfsPath) return;
    let live = true;
    void opfsImageUrl(opfsPath).then((url) => {
      if (live) setBlob({ path: opfsPath, url });
    });
    return () => {
      live = false;
    };
  }, [opfsPath]);
  if (!opfsPath) return uri;
  return blob?.path === opfsPath ? blob.url : undefined;
}

/** The cover fades in once loaded, over the same raised tile the letter cover uses. */
function CoverImage({ uri, size }: { uri: string | undefined; size: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View
      aria-hidden
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-md bg-raised"
    >
      {uri && (
        <FadeIn show={loaded} lift={0} duration={180}>
          <Image
            source={{ uri }}
            accessibilityIgnoresInvertColors
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            style={{ width: size, height: size }}
          />
        </FadeIn>
      )}
    </View>
  );
}
