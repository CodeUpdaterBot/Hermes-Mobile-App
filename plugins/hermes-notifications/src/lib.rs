use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::HermesNotifications;
#[cfg(mobile)]
use mobile::HermesNotifications;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the hermes-notifications APIs.
pub trait HermesNotificationsExt<R: Runtime> {
  fn hermes_notifications(&self) -> &HermesNotifications<R>;
}

impl<R: Runtime, T: Manager<R>> crate::HermesNotificationsExt<R> for T {
  fn hermes_notifications(&self) -> &HermesNotifications<R> {
    self.state::<HermesNotifications<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("hermes-notifications")
    .invoke_handler(tauri::generate_handler![
      commands::ensure_permission,
      commands::permission_state,
      commands::upsert,
      commands::finish,
      commands::clear,
      commands::clear_all
    ])
    .setup(|app, api| {
      #[cfg(mobile)]
      let hermes_notifications = mobile::init(app, api)?;
      #[cfg(desktop)]
      let hermes_notifications = desktop::init(app, api)?;
      app.manage(hermes_notifications);
      Ok(())
    })
    .build()
}
