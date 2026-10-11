// swift-tools-version:5.5
import PackageDescription

let package = Package(
  name: "tauri-plugin-hermes-notifications",
  platforms: [.iOS(.v13)],
  products: [
    .library(
      name: "tauri-plugin-hermes-notifications",
      type: .static,
      targets: ["tauri-plugin-hermes-notifications"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-hermes-notifications",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources")
  ]
)
