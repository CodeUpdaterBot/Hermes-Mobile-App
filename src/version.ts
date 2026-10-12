/**
 * The version shown in the app.
 *
 * Kept in code so the UI never hardcodes a release number, and pinned to the manifests by
 * `version.test.ts`: the phone displays this string, Gradle derives `versionCode` from
 * `tauri.conf.json`, and Cargo names the build. Drift between them is how a "0.2.0" release
 * quietly ships 0.1.1 binaries.
 */
export const APP_VERSION = '0.2.1'
