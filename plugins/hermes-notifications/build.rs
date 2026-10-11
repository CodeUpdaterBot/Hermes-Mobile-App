const COMMANDS: &[&str] = &[
  "ensurePermission",
  "permissionState",
  "notificationPermissionResult",
  "upsert",
  "finish",
  "clear",
  "clearAll",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .ios_path("ios")
    .build();
}
