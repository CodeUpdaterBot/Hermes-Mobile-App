package com.hermesagent.mobile

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import io.crates.keyring.Keyring
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var foldTracker: WindowInfoTrackerCallbackAdapter? = null

  // Latest FoldingFeature as JSON in WebView CSS px ("null" when there is no fold).
  @Volatile private var foldJson: String = "null"

  private val layoutListener = Consumer<WindowLayoutInfo> { info -> publishFold(info) }

  override fun onCreate(savedInstanceState: Bundle?) {
    // android-native-keyring-store requires this before its first secure
    // credential operation. Tauri initializes its Rust runtime in super.
    Keyring.initializeNdkContext(applicationContext)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  @SuppressLint("JavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    // Pull side of the fold bridge: survives reloads, read by src/fold-posture.ts.
    webView.addJavascriptInterface(FoldBridge(), "HermesFoldBridge")
  }

  override fun onStart() {
    super.onStart()
    val tracker = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this))
    tracker.addWindowLayoutInfoListener(this, ContextCompat.getMainExecutor(this), layoutListener)
    foldTracker = tracker
  }

  override fun onStop() {
    foldTracker?.removeWindowLayoutInfoListener(layoutListener)
    foldTracker = null
    super.onStop()
  }

  private fun publishFold(info: WindowLayoutInfo) {
    val fold = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
    Log.d("HermesFold", "layout features=${info.displayFeatures.size} fold=$fold")
    val view = webView
    foldJson = if (fold == null) "null" else {
      val density = resources.displayMetrics.density
      val origin = IntArray(2)
      view?.getLocationInWindow(origin)
      val bounds = fold.bounds
      JSONObject()
        .put("state", if (fold.state == FoldingFeature.State.HALF_OPENED) "half_opened" else "flat")
        .put("orientation", if (fold.orientation == FoldingFeature.Orientation.VERTICAL) "vertical" else "horizontal")
        .put("separating", fold.isSeparating)
        .put("bounds", JSONObject()
          .put("x", (bounds.left - origin[0]) / density)
          .put("y", (bounds.top - origin[1]) / density)
          .put("width", bounds.width() / density)
          .put("height", bounds.height() / density))
        .toString()
    }
    // Push side: update the global and let the page re-read its posture immediately.
    view?.evaluateJavascript("window.__HERMES_FOLD__=$foldJson;window.dispatchEvent(new Event('hermes-fold'))", null)
  }

  private inner class FoldBridge {
    @JavascriptInterface
    fun state(): String = foldJson
  }
}
