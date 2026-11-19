package app.lelap.headless

/**
 * The rules of a sandbox without a screen, the same as the app's WebView sandbox
 * (`apps/app/src/sandbox/SandboxHost.tsx`) so an add-on can't tell them apart.
 */
object SandboxRules {
  /** Only the inline page loads; every other address is refused, never handed to a browser. */
  fun mayLoad(url: String?): Boolean = url != null && url.startsWith("about:")

  /**
   * The script that hands [message] to the page the way react-native-webview does: a message
   * event on the document, which the page passes on to the add-on's worker.
   */
  fun deliver(message: String): String =
    "(function(){document.dispatchEvent(new MessageEvent('message',{data:${quote(message)}}));})();"

  /** [text] as a JavaScript string literal. */
  fun quote(text: String): String {
    val out = StringBuilder(text.length + 2).append('"')
    for (c in text) {
      when (c) {
        '"' -> out.append("\\\"")
        '\\' -> out.append("\\\\")
        '\n' -> out.append("\\n")
        '\r' -> out.append("\\r")
        // Line ends to JavaScript, also inside a string in older engines.
        ' ', ' ' -> out.append("\\u").append(String.format("%04x", c.code))
        else -> if (c < ' ') out.append("\\u").append(String.format("%04x", c.code)) else out.append(c)
      }
    }
    return out.append('"').toString()
  }
}
