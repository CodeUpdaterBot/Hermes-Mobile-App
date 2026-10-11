import Foundation
import UIKit
import UserNotifications
import Tauri

/**
 * OS notifications for Bots that are working, on iOS.
 *
 * iOS cannot render a progress bar inside a notification, and notifications have
 * no large icon slot, so this maps the same design onto what the platform really
 * supports rather than implying a bar that will never appear:
 *
 *   title     – the Bot name
 *   subtitle  – the current status / thinking line
 *   body      – an explicit completion estimate in words
 *   attachments – the Bot's avatar image, shown when the notification is expanded
 *   threadIdentifier – groups every working Bot together, like the Android group
 *
 * Progress updates are posted with the same identifier so they replace the
 * previous notification in place, exactly as the Android side does.
 */
class HermesNotificationsPlugin: Plugin {

  private let center = UNUserNotificationCenter.current()
  private let threadIdentifier = "app.hermes.mobile.BOTS"

  private func identifier(for id: String) -> String {
    // Stable across launches, unlike Swift's per-process String.hashValue.
    var hash: UInt64 = 1469598103934665603
    for byte in id.utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 1099511628211
    }
    return "hermes-bot-\(hash)"
  }

  private func summaryIdentifier() -> String { "hermes-bot-summary" }

  private func isGranted(_ settings: UNNotificationSettings) -> Bool {
    settings.authorizationStatus == .authorized
      || settings.authorizationStatus == .provisional
      || settings.authorizationStatus == .ephemeral
  }

  private func payload(granted: Bool, enabled: Bool) -> JSObject {
    let result = JSObject()
    result["granted"] = granted
    result["enabledInSystem"] = enabled
    return result
  }

  private func ok() -> JSObject {
    let result = JSObject()
    result["ok"] = true
    return result
  }

  /** Decodes the PNG the WebView rasterised so it can ride along as an attachment. */
  private func attachment(from base64: String?) -> UNNotificationAttachment? {
    guard let base64 = base64, !base64.isEmpty, let data = Data(base64Encoded: base64) else { return nil }
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("hermes-avatar-\(UUID().uuidString).png")
    do {
      try data.write(to: url)
    } catch {
      return nil
    }
    return try? UNNotificationAttachment(identifier: "avatar", url: url, options: nil)
  }

  private func post(identifier: String, bot: String, detail: String, percent: Int?, ongoing: Bool, iconBase64: String?) {
    let content = UNMutableNotificationContent()
    content.title = bot
    content.subtitle = detail
    // No progress bar exists on iOS, so the estimate is stated in words instead
    // of being silently dropped or faked.
    content.body = percent.map { "About \($0)% complete" } ?? detail
    content.threadIdentifier = threadIdentifier
    if #available(iOS 15.0, *) {
      // Progress updates must not buzz; only a finished run alerts.
      content.interruptionLevel = ongoing ? .passive : .active
    }
    if !ongoing {
      content.sound = .default
      content.body = detail
    }
    if let attachment = attachment(from: iconBase64) {
      content.attachments = [attachment]
    }
    center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
  }

  private func postSummary(count: Int) {
    guard count > 0 else { return }
    let content = UNMutableNotificationContent()
    content.title = "Hermes"
    content.body = count == 1 ? "1 Bot working" : "\(count) Bots working"
    content.threadIdentifier = threadIdentifier
    if #available(iOS 15.0, *) {
      content.interruptionLevel = .passive
    }
    center.add(UNNotificationRequest(identifier: summaryIdentifier(), content: content, trigger: nil))
  }

  // MARK: - Commands

  @objc public func ensurePermission(_ invoke: Invoke) {
    center.getNotificationSettings { settings in
      if self.isGranted(settings) {
        invoke.resolve(self.payload(granted: true, enabled: settings.alertSetting == .enabled))
        return
      }
      self.center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        invoke.resolve(self.payload(granted: granted, enabled: granted))
      }
    }
  }

  @objc public func permissionState(_ invoke: Invoke) {
    center.getNotificationSettings { settings in
      invoke.resolve(self.payload(granted: self.isGranted(settings), enabled: settings.alertSetting == .enabled))
    }
  }

  @objc public func upsert(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpsertArgs.self)
    post(
      identifier: identifier(for: args.id),
      bot: args.bot,
      detail: args.detail,
      percent: args.percent,
      ongoing: args.ongoing && args.running,
      iconBase64: args.iconBase64
    )
    invoke.resolve(ok())
  }

  @objc public func finish(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FinishArgs.self)
    // Re-posted under the same identifier: the running entry becomes the finished
    // one rather than a second notification appearing.
    post(
      identifier: identifier(for: args.id),
      bot: args.bot,
      detail: args.detail,
      percent: nil,
      ongoing: false,
      iconBase64: args.iconBase64
    )
    invoke.resolve(ok())
  }

  @objc public func clear(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(IdArgs.self)
    center.removeDeliveredNotifications(withIdentifiers: [identifier(for: args.id)])
    center.removePendingNotificationRequests(withIdentifiers: [identifier(for: args.id)])
    invoke.resolve(ok())
  }

  @objc public func clearAll(_ invoke: Invoke) {
    center.removeAllDeliveredNotifications()
    center.removeAllPendingNotificationRequests()
    invoke.resolve(ok())
  }
}

struct UpsertArgs: Decodable {
  let id: String
  let bot: String
  let detail: String
  let percent: Int?
  let running: Bool
  let ongoing: Bool
  let color: String?
  let iconBase64: String?
}

struct FinishArgs: Decodable {
  let id: String
  let bot: String
  let detail: String
  let color: String?
  let failed: Bool?
  let iconBase64: String?
}

struct IdArgs: Decodable {
  let id: String
}
