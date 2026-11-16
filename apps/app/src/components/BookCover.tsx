import { Image, Text, View } from 'react-native';

/** A `file://` URI for a cover saved on the phone, else the add-on's cover URL. */
export function coverUri(book: {
  coverPath: string | null;
  coverUrl?: string | null;
}): string | null {
  if (book.coverPath) return `file://${book.coverPath}`;
  return book.coverUrl ?? null;
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
        source={{ uri }}
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
