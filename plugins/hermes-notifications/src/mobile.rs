use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_hermes_notifications);

pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<HermesNotifications<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin(
    "app.hermes.mobile.notifications",
    "HermesNotificationsPlugin",
  )?;
  #[cfg(target_os = "ios")]
  let handle = api.register_ios_plugin(init_plugin_hermes_notifications)?;
  Ok(HermesNotifications(handle))
}

/// Access to the OS notification APIs.
pub struct HermesNotifications<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> HermesNotifications<R> {
  pub fn ensure_permission(&self) -> crate::Result<PermissionResponse> {
    self.0.run_mobile_plugin("ensurePermission", ()).map_err(Into::into)
  }

  pub fn permission_state(&self) -> crate::Result<PermissionResponse> {
    self.0.run_mobile_plugin("permissionState", ()).map_err(Into::into)
  }

  pub fn upsert(&self, payload: UpsertRequest) -> crate::Result<OkResponse> {
    self.0.run_mobile_plugin("upsert", payload).map_err(Into::into)
  }

  pub fn finish(&self, payload: FinishRequest) -> crate::Result<OkResponse> {
    self.0.run_mobile_plugin("finish", payload).map_err(Into::into)
  }

  pub fn clear(&self, payload: IdRequest) -> crate::Result<OkResponse> {
    self.0.run_mobile_plugin("clear", payload).map_err(Into::into)
  }

  pub fn clear_all(&self) -> crate::Result<OkResponse> {
    self.0.run_mobile_plugin("clearAll", ()).map_err(Into::into)
  }
}
