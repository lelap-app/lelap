package app.lelap.headless

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * In-app add-ons while no screen of the app is up (M123): one WebView each, never attached to a
 * window, with the settings of the app's own sandbox. The page is the same (`sandbox/page.ts`),
 * so the add-on's code still runs in a worker and reaches the network only by asking the app,
 * which fetches through the same native fetch and host rules as with the screen up.
 */
internal class HeadlessSandbox(
  private val context: Context,
  private val onMessage: (key: String, data: String) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  // Touched on the main thread only.
  private val views = HashMap<String, WebView>()

  fun open(key: String, html: String) = main.post {
    views.remove(key)?.destroy()
    views[key] = create(key, html)
  }

  fun post(key: String, message: String) = main.post {
    views[key]?.evaluateJavascript(SandboxRules.deliver(message), null)
  }

  fun close(key: String) = main.post { views.remove(key)?.destroy() }

  fun closeAll() = main.post {
    for (view in views.values) view.destroy()
    views.clear()
  }

  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  private fun create(key: String, html: String): WebView {
    val view = WebView(context.applicationContext)
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      @Suppress("DEPRECATION")
      allowFileAccessFromFileURLs = false
      @Suppress("DEPRECATION")
      allowUniversalAccessFromFileURLs = false
      cacheMode = WebSettings.LOAD_NO_CACHE
      setSupportMultipleWindows(false)
      javaScriptCanOpenWindowsAutomatically = false
      mediaPlaybackRequiresUserGesture = true
      setGeolocationEnabled(false)
      // The page needs no network of its own: everything goes through the app.
      blockNetworkLoads = true
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
    view.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        !SandboxRules.mayLoad(request.url?.toString())
    }
    // The name react-native-webview gives its bridge, which the page looks for.
    view.addJavascriptInterface(Bridge(key, onMessage), "ReactNativeWebView")
    view.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null)
    return view
  }

  private class Bridge(private val key: String, private val onMessage: (String, String) -> Unit) {
    @JavascriptInterface
    fun postMessage(data: String) = onMessage(key, data)
  }
}
