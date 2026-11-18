package app.lelap.netfs

import android.content.Context
import app.lelap.text.NativeText

/**
 * A failure in the profile's language, for text native code shows itself (a download's error).
 * The app shows the same lines through `t()` for the error codes.
 */
object Messages {
  fun describe(context: Context, failure: NetFailure): String = when (failure.kind) {
    NetFailure.Kind.LOGIN -> NativeText.t(context, "The server refused the login. Log in again in Settings.")
    NetFailure.Kind.HOST_KEY_CHANGED -> NativeText.t(
      context,
      "The server’s host key changed, so Lelap did not connect. If you changed it yourself, remove the server in Settings and add it again.",
    )
    NetFailure.Kind.HOST_KEY_UNKNOWN -> NativeText.t(context, "The server’s host key is not trusted yet. Add the server again.")
    NetFailure.Kind.PRIVATE_KEY -> NativeText.t(context, "The private key can’t be read. Check its passphrase.")
    NetFailure.Kind.NOT_FOUND -> NativeText.t(context, "The file is no longer on the server.")
    NetFailure.Kind.DENIED -> NativeText.t(context, "The server does not let this login read the file.")
    NetFailure.Kind.ADDRESS -> NativeText.t(context, "The server address is not valid.")
    NetFailure.Kind.TIMEOUT -> NativeText.t(context, "The server did not answer within 30 s.")
    NetFailure.Kind.UNREACHABLE -> NativeText.t(context, "No answer from the server.")
  }
}
