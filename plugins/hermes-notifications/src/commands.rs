use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::HermesNotificationsExt;
use crate::Result;

#[command]
pub(crate) async fn ensure_permission<R: Runtime>(app: AppHandle<R>) -> Result<PermissionResponse> {
  app.hermes_notifications().ensure_permission()
}

#[command]
pub(crate) async fn permission_state<R: Runtime>(app: AppHandle<R>) -> Result<PermissionResponse> {
  app.hermes_notifications().permission_state()
}

#[command]
pub(crate) async fn upsert<R: Runtime>(app: AppHandle<R>, payload: UpsertRequest) -> Result<OkResponse> {
  app.hermes_notifications().upsert(payload)
}

#[command]
pub(crate) async fn finish<R: Runtime>(app: AppHandle<R>, payload: FinishRequest) -> Result<OkResponse> {
  app.hermes_notifications().finish(payload)
}

#[command]
pub(crate) async fn clear<R: Runtime>(app: AppHandle<R>, payload: IdRequest) -> Result<OkResponse> {
  app.hermes_notifications().clear(payload)
}

#[command]
pub(crate) async fn clear_all<R: Runtime>(app: AppHandle<R>) -> Result<OkResponse> {
  app.hermes_notifications().clear_all()
}
