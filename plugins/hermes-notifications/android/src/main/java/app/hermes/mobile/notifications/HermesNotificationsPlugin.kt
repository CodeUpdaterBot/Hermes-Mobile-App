package app.hermes.mobile.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * OS notifications for Bots that are working, so a long run stays visible on the
 * lockscreen while the user is elsewhere.
 *
 * Layout: the Bot's own avatar as the large icon on the left, the Bot name as the
 * title, the current status/thinking line underneath, and a progress bar below
 * that. One notification per Bot, keyed by session identity and updated in place:
 * a Bot that calls twelve tools must not produce twelve notifications. Ongoing
 * notifications cannot be swiped away mid-run, and completion converts the same
 * notification into an ordinary clearable one instead of posting a second entry.
 *
 * The Android runtime permission must be declared as an ALIAS on the plugin, not merely named
 * in the manifest: `Plugin.requestPermissionForAliases` resolves the strings it passes to the
 * framework from `@TauriPlugin.permissions`, and with a bare annotation it resolves nothing —
 * `permissionActivityResult` is never called, so Android never shows the prompt and the caller
 * waits for a dialog that was never asked for. The alias below is the one `ensurePermission`
 * requests; keep the two in step.
 */
@TauriPlugin(
  permissions = [
    Permission(
      alias = "postNotifications",
      strings = ["android.permission.POST_NOTIFICATIONS"]
    )
  ]
)
class HermesNotificationsPlugin(private val activity: android.app.Activity) : Plugin(activity) {

  companion object {
    private const val RUNNING_CHANNEL = "hermes-bots-running"
    private const val DONE_CHANNEL = "hermes-bots-done"
    private const val GROUP_KEY = "app.hermes.mobile.BOTS"
    private const val REQUEST_CODE = 4711
    private const val PREFS = "hermes-notifications"

    /** Android 13 introduced a runtime notification permission. */
    private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

    /** The alias declared on `@TauriPlugin` above; the framework requests by alias, not by string. */
    private const val POST_NOTIFICATIONS_ALIAS = "postNotifications"
  }

  @InvokeArg
  class UpsertArgs {
    lateinit var id: String
    var bot: String = "Hermes"
    /** Status / current thinking line shown under the Bot name. */
    var detail: String = ""
    /** 0..100 of the estimated completion. */
    var percent: Int = 0
    var running: Boolean = true
    var ongoing: Boolean = true
    var color: String = "#49C088"
    /** PNG of the Bot avatar, base64 without the data-url prefix. */
    var iconBase64: String? = null
  }

  @InvokeArg
  class IdArgs {
    lateinit var id: String
  }

  @InvokeArg
  class FinishArgs {
    lateinit var id: String
    var bot: String = "Hermes"
    var detail: String = ""
    var color: String = "#49C088"
    var failed: Boolean = false
    var iconBase64: String? = null
  }

  private val manager: NotificationManagerCompat
    get() = NotificationManagerCompat.from(activity)

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val system = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    system.createNotificationChannel(
      NotificationChannel(RUNNING_CHANNEL, "Bot activity", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Progress while a Bot is working"
        setShowBadge(false)
        enableVibration(false)
      }
    )
    system.createNotificationChannel(
      NotificationChannel(DONE_CHANNEL, "Bot results", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "A Bot finished or needs attention"
      }
    )
  }

  private fun parseColor(value: String): Int = try {
    Color.parseColor(value)
  } catch (_: IllegalArgumentException) {
    Color.parseColor("#49C088")
  }

  /**
   * The avatar is rasterised in the WebView (Android cannot decode SVG) and sent
   * as PNG. A failure here must not cost the user the notification itself — it
   * simply falls back to the small icon.
   */
  private fun decodeIcon(base64: String?): Bitmap? {
    if (base64.isNullOrEmpty()) return null
    return try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: IllegalArgumentException) {
      null
    } catch (_: OutOfMemoryError) {
      null
    }
  }

  private fun contentIntent(): PendingIntent? {
    val launch = activity.packageManager.getLaunchIntentForPackage(activity.packageName) ?: return null
    launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(activity, REQUEST_CODE, launch, PendingIntent.FLAG_IMMUTABLE)
  }

  /** Stable per-Bot notification id so an update replaces the previous entry. */
  private fun notificationId(id: String): Int = id.hashCode() and 0x0FFFFFFF

  private fun post(id: String, builder: NotificationCompat.Builder) {
    val manager = this.manager
    if (!manager.areNotificationsEnabled()) return
    // A missing POST_NOTIFICATIONS grant on Android 13+ throws; treat it as "off".
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(activity, POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    try {
      manager.notify(notificationId(id), builder.build())
    } catch (_: SecurityException) {
      // Permission revoked between the check and the post; nothing to surface.
    }
  }

  private fun buildBase(bot: String, detail: String, color: String, channel: String, icon: Bitmap?): NotificationCompat.Builder {
    val builder = NotificationCompat.Builder(activity, channel)
      .setSmallIcon(R.drawable.ic_hermes_notification)
      .setContentTitle(bot)
      .setContentText(detail)
      .setColor(parseColor(color))
      .setColorized(false)
      .setGroup(GROUP_KEY)
      .setContentIntent(contentIntent())
      .setPriority(NotificationCompat.PRIORITY_LOW)
    if (icon != null) {
      // What makes several working Bots distinguishable at a glance.
      builder.setLargeIcon(scaleForLargeIcon(icon))
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(detail))
    }
    return builder
  }

  /** Large icons are drawn at ~64dp; a full-size avatar would be needless memory. */
  private fun scaleForLargeIcon(icon: Bitmap): Bitmap {
    val target = (64 * Resources.getSystem().displayMetrics.density).toInt().coerceAtLeast(96)
    if (icon.width <= target && icon.height <= target) return icon
    val ratio = icon.width.toFloat() / icon.height.toFloat()
    val width = if (ratio >= 1f) target else (target * ratio).toInt()
    val height = if (ratio >= 1f) (target / ratio).toInt() else target
    return Bitmap.createScaledBitmap(icon, width.coerceAtLeast(1), height.coerceAtLeast(1), true)
  }

  private fun activeCount(): Int = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .all.keys.count { it.startsWith("active:") }

  private fun setActive(id: String, active: Boolean) {
    val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (active) prefs.putBoolean("active:$id", true) else prefs.remove("active:$id")
    prefs.apply()
  }

  private fun postSummary(count: Int) {
    if (count <= 0) return
    val summary = NotificationCompat.Builder(activity, RUNNING_CHANNEL)
      .setSmallIcon(R.drawable.ic_hermes_notification)
      .setContentTitle("Hermes")
      .setContentText(if (count == 1) "1 Bot working" else "$count Bots working")
      .setGroup(GROUP_KEY)
      .setGroupSummary(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setSilent(true)
    post("__summary__", summary)
  }

  private fun dropSummaryIfIdle() {
    val remaining = activeCount()
    if (remaining <= 0) manager.cancel(notificationId("__summary__")) else postSummary(remaining)
  }

  @Command
  fun ensurePermission(invoke: Invoke) {
    val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ContextCompat.checkSelfPermission(activity, POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    } else this.manager.areNotificationsEnabled()

    if (granted || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      invoke.resolve(permissionPayload(granted))
      return
    }
    requestPermissionForAlias(POST_NOTIFICATIONS_ALIAS, invoke, "notificationPermissionResult")
  }

  /**
   * Resolves the held `ensurePermission` invoke once the user has answered Android's dialog.
   *
   * This MUST be a [PermissionCallback] and not a Command: the framework finds the callback by
   * method name in the permission-callback registry, which `PluginHandle.indexMethods` populates
   * only from methods carrying this annotation. As a `@Command` it was never registered, so the
   * invoke was neither resolved nor rejected and the Settings screen spun on "Asking Android…"
   * forever, with no error and nothing to retry.
   */
  @PermissionCallback
  fun notificationPermissionResult(invoke: Invoke) {
    val granted = ContextCompat.checkSelfPermission(activity, POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    invoke.resolve(permissionPayload(granted))
  }

  @Command
  fun permissionState(invoke: Invoke) {
    val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ContextCompat.checkSelfPermission(activity, POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    } else this.manager.areNotificationsEnabled()
    invoke.resolve(permissionPayload(granted))
  }

  private fun permissionPayload(granted: Boolean): JSObject = JSObject().apply {
    put("granted", granted)
    put("enabledInSystem", manager.areNotificationsEnabled())
  }

  @Command
  fun upsert(invoke: Invoke) {
    val args = invoke.parseArgs(UpsertArgs::class.java)
    ensureChannels()
    val builder = buildBase(args.bot, args.detail, args.color, RUNNING_CHANNEL, decodeIcon(args.iconBase64))
      .setOnlyAlertOnce(true)
      .setOngoing(args.ongoing && args.running)
      .setProgress(100, args.percent.coerceIn(0, 100), false)
      .setSilent(true)
    post(args.id, builder)
    if (args.running) {
      setActive(args.id, true)
      postSummary(activeCount())
    }
    invoke.resolve(JSObject().apply { put("ok", true) })
  }

  @Command
  fun finish(invoke: Invoke) {
    val args = invoke.parseArgs(FinishArgs::class.java)
    ensureChannels()
    val builder = buildBase(args.bot, args.detail, args.color, DONE_CHANNEL, decodeIcon(args.iconBase64))
      .setOngoing(false)
      .setAutoCancel(true)
      // Progress is removed rather than pinned at 100 so a finished entry does not
      // keep a full bar that implies work is still happening.
      .setProgress(0, 0, false)
      .setOnlyAlertOnce(false)
    post(args.id, builder)
    setActive(args.id, false)
    dropSummaryIfIdle()
    invoke.resolve(JSObject().apply { put("ok", true) })
  }

  @Command
  fun clear(invoke: Invoke) {
    val args = invoke.parseArgs(IdArgs::class.java)
    manager.cancel(notificationId(args.id))
    setActive(args.id, false)
    dropSummaryIfIdle()
    invoke.resolve(JSObject().apply { put("ok", true) })
  }

  @Command
  fun clearAll(invoke: Invoke) {
    val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    for (key in prefs.all.keys.toList()) {
      if (key.startsWith("active:")) manager.cancel(notificationId(key.removePrefix("active:")))
    }
    activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    manager.cancel(notificationId("__summary__"))
    manager.cancelAll()
    invoke.resolve(JSObject().apply { put("ok", true) })
  }
}
