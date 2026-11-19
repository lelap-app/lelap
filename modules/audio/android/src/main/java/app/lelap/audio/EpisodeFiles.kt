package app.lelap.audio

/**
 * The file an episode on its show's automatic choice streams (M121): the smallest on mobile data,
 * the feed's own otherwise. The app picks when it loads an episode; the service picks again for
 * every book it gives the player, so Up Next and the car follow the connection with the app
 * closed. The book keeps its file location, so the place and the journal stay.
 */
object EpisodeFiles {
  fun uriFor(file: BookFile, mobileData: Boolean): String {
    val auto = file.auto ?: return file.uri
    // An address that is neither (a download that finished since) plays as the app sent it.
    if (file.uri != auto.unmetered && file.uri != auto.metered) return file.uri
    return if (mobileData) auto.metered else auto.unmetered
  }
}
