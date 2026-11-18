package app.lelap.audio

import java.security.MessageDigest

/**
 * Covers saved on the phone, for Android Auto (M74). Auto runs in another process and can't open
 * the app's files, so the browse tree names them as `content://<package>.covers/<key>` and
 * [CoverProvider] serves them. The key is a hash of the cover's own address: the provider only
 * opens covers the car lists, and the address never leaves the app. The provider is not exported;
 * the app that browses the lists gets read access to the covers in them (M107, [grants]).
 */
object CarCovers {
  const val AUTHORITY_SUFFIX = ".covers"

  fun authority(packageName: String): String = packageName + AUTHORITY_SUFFIX

  /** Whether a cover is on the phone, so the car needs it through the provider. */
  fun isLocal(coverUri: String): Boolean = coverUri.startsWith("file://") || coverUri.startsWith("content://")

  /** What the car gets for [coverUri]: web covers as they are, local ones through the provider. */
  fun artworkUri(coverUri: String?, authority: String?): String? = when {
    coverUri.isNullOrBlank() -> null
    coverUri.startsWith("https://") || coverUri.startsWith("http://") -> coverUri
    authority != null && isLocal(coverUri) -> "content://$authority/${key(coverUri)}"
    else -> null
  }

  /**
   * The provider addresses among [artworkUris] that [controller] may read: a car app gets the
   * covers of the lists it asked for, and nothing else. Lelap reads its own files, and a
   * controller whose package Android doesn't tell can't be granted anything.
   */
  fun grants(artworkUris: List<String?>, authority: String, controller: String, own: String): List<String> {
    if (controller.isBlank() || controller == own || controller == LEGACY_UNKNOWN) return emptyList()
    return artworkUris.filterNotNull().filter { it.startsWith("content://$authority/") }.distinct()
  }

  // What Media3 calls a controller of the old API whose package it can't see.
  private const val LEGACY_UNKNOWN = "android.media.session.MediaController"

  /** By the file's extension; JPEG, the usual cover, when there is none. */
  fun mimeType(coverUri: String?): String {
    val name = coverUri?.substringBefore('?')?.lowercase().orEmpty()
    return when {
      name.endsWith(".png") -> "image/png"
      name.endsWith(".webp") -> "image/webp"
      name.endsWith(".gif") -> "image/gif"
      else -> "image/jpeg"
    }
  }

  /**
   * Whether the provider may hand a `content:` cover (as found by [find]) to another app: never
   * through one of Lelap's own providers. A cover address can arrive from sync or an add-on.
   */
  fun servableDocument(coverUri: String, packageName: String): Boolean {
    val authority = coverUri.removePrefix("content://").substringBefore('/')
    return authority.isNotEmpty() && authority != packageName && !authority.startsWith("$packageName.")
  }

  /**
   * Whether the provider may hand a file to another app, by the name of the file it really opens
   * (after `..`, links and decoding): images only, never the database or another private file.
   */
  fun servableFile(canonicalName: String): Boolean =
    IMAGE_EXTENSIONS.any { canonicalName.lowercase().endsWith(it) }

  private val IMAGE_EXTENSIONS = listOf(".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".avif", ".bmp")

  fun key(coverUri: String): String =
    MessageDigest.getInstance("SHA-256").digest(coverUri.toByteArray()).joinToString("") { "%02x".format(it) }

  /** The local cover behind [key], among the books the car can list now; null for any other. */
  fun find(key: String, snapshot: CarSnapshot, journal: BookPlaylist?): String? =
    sequenceOf(snapshot.continueListening, snapshot.onPhone, snapshot.podcasts, snapshot.upNext)
      .flatten()
      .map { it.playlist.coverUri }
      .plus(journal?.coverUri)
      .filterNotNull()
      .firstOrNull { isLocal(it) && key(it) == key }
}
