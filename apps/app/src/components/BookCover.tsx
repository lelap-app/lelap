import { type CoverBadge, localFileUri } from '@lelap/core';
import { useEffect, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

import { CoverBadgeRow } from './CoverBadges';
import { FadeIn } from './Motion';
import { coverAtAddressInUse } from '../addresses';
import { catalogCoverSource, savedCatalogCover } from '../catalogCovers';
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

/** A `file://` or `content://` URI for a cover saved on the phone, else the cover's own URL. */
export function coverUri(book: {
  coverPath: string | null;
  coverUrl?: string | null;
}): string | null {
  if (book.coverPath && Platform.OS !== 'web') return localFileUri(book.coverPath);
  // A matched book's catalog cover, from the copy on the phone once there is one (M80).
  const saved = savedCatalogCover(book.coverUrl);
  if (saved) return saved;
  // The web keeps its saved covers in OPFS, which an <img> can't read: the cover URL first, and
  // a server folder's cover through a blob URL (see CoverImage).
  // A server's cover from the address it answers at now (M146).
  const url = webSafe(coverAtAddressInUse(book.coverUrl));
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
  fallbackUri,
  title,
  size,
  badges = [],
}: {
  uri: string | null | undefined;
  /** Shown when `uri` doesn't load, such as the book's cover under a chapter's picture. */
  fallbackUri?: string | null | undefined;
  title: string;
  size: number;
  badges?: CoverBadge[];
}) {
  const cover = <PlainCover uri={uri} fallbackUri={fallbackUri} title={title} size={size} />;
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
  fallbackUri,
  title,
  size,
}: {
  uri: string | null | undefined;
  fallbackUri: string | null | undefined;
  title: string;
  size: number;
}) {
  // Addresses that failed to load: a broken link, or one the proxy refused, showed a blank tile.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // A kept catalog cover that went missing falls back to the catalog's address (M105).
  const backup = (u: string | null | undefined) =>
    u && failed.has(u) ? catalogCoverSource(u) : null;
  const wanted = [uri, backup(uri), fallbackUri, backup(fallbackUri)]
    .map((u) => (u ? (webSafe(u) ?? u) : null))
    .find((u) => u !== null && !failed.has(u));
  const shown = useShownUri(wanted ?? null);
  // The image, or the bare tile while a cover is read from OPFS, as while an image loads.
  if (shown !== null) {
    return (
      <CoverImage
        key={shown}
        uri={shown}
        size={size}
        onError={() => wanted && setFailed((old) => new Set(old).add(wanted))}
      />
    );
  }
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
function CoverImage({
  uri,
  size,
  onError,
}: {
  uri: string | undefined;
  size: number;
  onError: () => void;
}) {
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
            onError={onError}
            style={{ width: size, height: size }}
          />
        </FadeIn>
      )}
    </View>
  );
}
