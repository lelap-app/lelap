package app.lelap.audio

/** What to do after a load failed with an HTTP status. */
enum class LinkRetry {
  /** Not an expired link: ExoPlayer's usual policy decides. */
  DEFAULT,
  /** Open the original URL again now; a `/resolve/…` URL redirects to a fresh link. */
  REFRESH,
  /** Refreshed once and still refused: the link is gone for good. */
  GIVE_UP,
}

/**
 * Add-ons whose audio links expire hand out a stable `/resolve/…` URL that redirects to a fresh
 * one (see the protocol docs). When the audio host answers 403 or 410, the player opens the
 * original URL again, once, and continues from the same byte, so the place is kept.
 */
object ExpiringLinks {
  fun isExpired(code: Int): Boolean = code == 403 || code == 410

  /** [errorCount] counts this load's failures so far, this one included. */
  fun decide(code: Int, errorCount: Int): LinkRetry = when {
    !isExpired(code) -> LinkRetry.DEFAULT
    errorCount <= 1 -> LinkRetry.REFRESH
    else -> LinkRetry.GIVE_UP
  }
}
