import { Image, Platform, Text, View } from 'react-native';

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

/** The cover, or a tile with the title's first letter when there is none. */
export function BookCover({
  uri,
  title,
  size,
}: {
  uri: string | null | undefined;
  title: string;
  size: number;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri: webSafe(uri) ?? uri }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size }}
        className="rounded-md bg-raised"
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center rounded-md bg-raised"
    >
      <Text style={{ fontSize: size / 2.5 }} className="font-semibold text-muted">
        {title.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}
