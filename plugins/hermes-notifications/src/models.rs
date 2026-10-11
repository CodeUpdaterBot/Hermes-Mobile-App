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
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRequest {
  pub id: String,
  pub bot: String,
  pub action: String,
  /// 0..=100 for a determinate bar; negative means indeterminate.
  pub percent: i32,
  pub running: bool,
  pub ongoing: bool,
  pub color: String,
}

/// Convert an ongoing notification into a finished, clearable one.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishRequest {
  pub id: String,
  pub bot: String,
  pub action: String,
  pub color: String,
  pub failed: bool,
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
