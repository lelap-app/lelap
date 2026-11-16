import { Image, Text, View } from 'react-native';

/** The cover, or a tile with the title's first letter when there is none. */
export function BookCover({
  path,
  title,
  size,
}: {
  path: string | null;
  title: string;
  size: number;
}) {
  if (path) {
    return (
      <Image
        source={{ uri: `file://${path}` }}
        style={{ width: size, height: size }}
        className="rounded-md"
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
