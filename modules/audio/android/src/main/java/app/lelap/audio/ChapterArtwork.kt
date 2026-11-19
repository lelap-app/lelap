package app.lelap.audio

/**
 * The picture for the notification, lock screen and car at a place in the book (M103): that of
 * the last chapter picture started by then, else the book's cover. A mark without a picture goes
 * back to the cover, as the chapters file asks.
 */
object ChapterArtwork {
  fun at(playlist: BookPlaylist, index: Int, positionMs: Long): String? {
    if (playlist.artworks.isEmpty()) return playlist.coverUri
    val bookPosition = playlist.files.take(index).sumOf { it.durationMs.coerceAtLeast(0L) } + positionMs
    val mark = playlist.artworks.lastOrNull { it.startMs <= bookPosition } ?: return playlist.coverUri
    return mark.uri ?: playlist.coverUri
  }
}
