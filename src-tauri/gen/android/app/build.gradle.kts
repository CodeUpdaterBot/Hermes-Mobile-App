import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing is intentionally environment-driven. Keep the upload
// keystore and passwords outside the repository and never commit them.
val hermesMobileKeystore = System.getenv("HERMES_MOBILE_KEYSTORE")?.takeIf { it.isNotBlank() }
val hermesMobileStorePassword = System.getenv("HERMES_MOBILE_STORE_PASSWORD")?.takeIf { it.isNotBlank() }
val hermesMobileKeyAlias = System.getenv("HERMES_MOBILE_KEY_ALIAS")?.takeIf { it.isNotBlank() }
val hermesMobileKeyPassword = System.getenv("HERMES_MOBILE_KEY_PASSWORD")?.takeIf { it.isNotBlank() }

android {
    compileSdk = 36
    namespace = "com.hermesagent.mobile"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.hermesagent.mobile"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hermesMobileKeystore != null && hermesMobileStorePassword != null && hermesMobileKeyAlias != null && hermesMobileKeyPassword != null) {
            create("hermesMobileRelease") {
                storeFile = file(hermesMobileKeystore)
                storePassword = hermesMobileStorePassword
                keyAlias = hermesMobileKeyAlias
                keyPassword = hermesMobileKeyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("hermesMobileRelease")
            // Hermes Mobile supports private Tailscale/LAN HTTP gateways. The
            // native password path rejects public HTTP before sending credentials.
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // Foldable posture (FoldingFeature) for the book/tabletop layouts.
    implementation("androidx.window:window:1.4.0")
    implementation("androidx.window:window-java:1.4.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")