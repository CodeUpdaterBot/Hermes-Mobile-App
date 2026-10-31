const COMMANDS: &[&str] = &[
  "ensurePermission",
  "permissionState",
  "notificationPermissionResult",
  "upsert",
  "finish",
  "clear",
  "clearAll",
  "approval",
  "register_listener",
  "remove_listener",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .ios_path("ios")
    .build();
}
