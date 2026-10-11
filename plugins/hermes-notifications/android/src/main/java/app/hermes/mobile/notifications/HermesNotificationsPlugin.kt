package app.hermes.mobile.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * OS notifications for Bots that are working, so a long run stays visible on the
 * lockscreen while the user is elsewhere in the app or has put the phone down.
 *
 * One notification per Bot, keyed by the session identity, and updated in place:
 * a Bot that calls twelve tools must not produce twelve notifications. Ongoing
 * notifications cannot be swiped away mid-run, and completion converts the same
 * notification into an ordinary clearable one instead of posting a second entry.
 */
@TauriPlugin
class HermesNotificationsPlugin(private val activity: android.app.Activity) : Plugin(activity) {

  companion object {
    private const val RUNNING_CHANNEL = "hermes-bots-running"
    private const val DONE_CHANNEL = "hermes-bots-done"
    private const val GROUP_KEY = "app.hermes.mobile.BOTS"
    private const val SUMMARY_ID = 1
    private const val REQUEST_CODE = 4711

    /** Android 13 introduced a runtime notification permission. */
    private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"
  }

  @InvokeArg
  class UpsertArgs {
    lateinit var id: String
    var bot: String = "Hermes"
    var action: String = ""
    /** 0..100 for a determinate bar; null (or negative) means indeterminate. */
    var percent: Int = -1
    var running: Boolean = true
    var ongoing: Boolean = true
    var color: String = "#49C088"
  }

  @InvokeArg
  class IdArgs {
    lateinit var id: String
  }

  @InvokeArg
  class FinishArgs {
    lateinit var id: String
    var bot: String = "Hermes"
    var action: String = ""
    var color: String = "#49C088"
    var failed: Boolean = false
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

  private fun buildBase(bot: String, action: String, color: String, channel: String): NotificationCompat.Builder =
    NotificationCompat.Builder(activity, channel)
      .setSmallIcon(R.drawable.ic_hermes_notification)
      .setContentTitle(bot)
      .setContentText(action)
      .setColor(parseColor(color))
      .setColorized(false)
      .setGroup(GROUP_KEY)
      .setContentIntent(contentIntent())
      .setPriority(NotificationCompat.PRIORITY_LOW)

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

  private fun activeCount(): Int = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    .all.keys.count { it.startsWith("active:") }

  private fun setActive(id: String, active: Boolean) {
    val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (active) prefs.putBoolean("active:$id", true) else prefs.remove("active:$id")
    prefs.apply()
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
    requestPermissionForAlias(POST_NOTIFICATIONS, invoke, "notificationPermissionResult")
  }

  @Command
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
    val builder = buildBase(args.bot, args.action, args.color, RUNNING_CHANNEL)
      .setOnlyAlertOnce(true)
      .setOngoing(args.ongoing && args.running)
      .setProgress(100, args.percent.coerceIn(0, 100), args.percent < 0)
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
    val builder = buildBase(args.bot, args.action, args.color, DONE_CHANNEL)
      .setOngoing(false)
      .setAutoCancel(true)
      .setProgress(0, 0, false)
      .setOnlyAlertOnce(false)
    post(args.id, builder)
    setActive(args.id, false)
    val remaining = activeCount()
    if (remaining <= 0) manager.cancel(notificationId("__summary__")) else postSummary(remaining)
    invoke.resolve(JSObject().apply { put("ok", true) })
  }

  @Command
  fun clear(invoke: Invoke) {
    val args = invoke.parseArgs(IdArgs::class.java)
    manager.cancel(notificationId(args.id))
    setActive(args.id, false)
    val remaining = activeCount()
    if (remaining <= 0) manager.cancel(notificationId("__summary__")) else postSummary(remaining)
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

private const val PREFS = "hermes-notifications"
