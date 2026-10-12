use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<HermesNotifications<R>> {
  Ok(HermesNotifications(app.clone()))
}

/// Desktop has no phone lockscreen, so every call is a resolved no-op. Reporting
/// `granted: false` keeps the mobile-only UI from claiming notifications work
/// here, rather than showing a toggle that silently does nothing.
pub struct HermesNotifications<R: Runtime>(AppHandle<R>);

impl<R: Runtime> HermesNotifications<R> {
  pub fn ensure_permission(&self) -> crate::Result<PermissionResponse> {
    Ok(PermissionResponse::default())
  }

  pub fn permission_state(&self) -> crate::Result<PermissionResponse> {
    Ok(PermissionResponse::default())
  }

  pub fn upsert(&self, _payload: UpsertRequest) -> crate::Result<OkResponse> {
    Ok(OkResponse { ok: false })
  }

  pub fn finish(&self, _payload: FinishRequest) -> crate::Result<OkResponse> {
    Ok(OkResponse { ok: false })
  }

  pub fn clear(&self, _payload: IdRequest) -> crate::Result<OkResponse> {
    Ok(OkResponse { ok: false })
  }

  pub fn clear_all(&self) -> crate::Result<OkResponse> {
    Ok(OkResponse { ok: false })
  }
}
