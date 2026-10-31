use serde::{Deserialize, Serialize};

/// Result of a permission probe. `enabled_in_system` is separate from `granted`
/// because a user can grant POST_NOTIFICATIONS and still have notifications
/// switched off in system settings.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
  pub granted: bool,
  pub enabled_in_system: bool,
}

/// Create or update the single notification owned by one Bot session.
/// Field names mirror the Android/iOS argument classes (`detail`, `iconBase64`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRequest {
  pub id: String,
  pub bot: String,
  /// Status line under the Bot name.
  #[serde(default)]
  pub detail: String,
  /// 0..=100 for a determinate bar; negative means indeterminate.
  #[serde(default)]
  pub percent: i32,
  pub running: bool,
  pub ongoing: bool,
  pub color: String,
  /// PNG of the Bot avatar, base64 without the data-url prefix.
  #[serde(default)]
  pub icon_base64: Option<String>,
}

/// Convert an ongoing notification into a finished, clearable one.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishRequest {
  pub id: String,
  pub bot: String,
  #[serde(default)]
  pub detail: String,
  pub color: String,
  pub failed: bool,
  #[serde(default)]
  pub icon_base64: Option<String>,
}

/// A Bot is blocked on a dangerous command until the user allows or denies it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
  pub request_id: String,
  pub bot: String,
  #[serde(default)]
  pub command: String,
  #[serde(default)]
  pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdRequest {
  pub id: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResponse {
  pub ok: bool,
}
