# @repo/mobile

React Native mobile app and iOS/watchOS companion owner for the dive-app monorepo.

This app tracks React Native `0.85.3`, the latest official `Active` support line checked on 2026-06-13. React Native does not publish an LTS label; treat `0.85.x` as the current conservative support target until the repo intentionally moves to a newer active line.

This app was initialized from the React Native CLI template and then adapted for this Yarn 1 workspace. It follows the local RN UI guide:

- `src/App.tsx` is the app UI entry.
- `src/providers.tsx` owns top-level providers.
- `src/components/navigation` is the navigation boundary.
- `src/components/ui` contains reusable UI primitives and composed components.
- `src/screens/<area>/screen.tsx` contains route-level screen containers.
- `ios/Divenary.xcodeproj` owns the iPhone app target `Divenary` and the embedded watchOS companion target `DivenaryWatchApp`.
- `ios/DivenaryWatchApp` contains the SwiftUI watchOS companion source.

## Scripts

From the repo root:

```bash
yarn workspace @repo/mobile start
yarn workspace @repo/mobile typecheck
yarn workspace @repo/mobile test
yarn workspace @repo/mobile lint
yarn workspace @repo/mobile ios
yarn workspace @repo/mobile android
yarn workspace @repo/mobile watch:build
yarn workspace @repo/mobile watch:list
yarn workspace @repo/mobile watch:ui:check
```

Root aliases:

```bash
yarn mobile:typecheck
yarn ios:build
yarn watch:build
```

## iOS Setup

The iOS project requires CocoaPods before native CLI builds can pass:

```bash
yarn workspace @repo/mobile ios:pods
yarn ios:build
```

`ios:build` uses `CODE_SIGNING_ALLOWED=NO` and a temp DerivedData path. It validates the CocoaPods workspace and the generated React/Codegen pod artifacts before building, then runs `pod install` when those files are missing.

Wave 3A native Auth uses public values from `.env.development`:

```dotenv
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
GOOGLE_WEB_CLIENT_ID=
GOOGLE_IOS_CLIENT_ID=
```

Copy the key names from `.env.development.example` and do not commit real values. Provider secret and `service_role` must never be placed in the app bundle. The iPhone target owns the Sign in with Apple entitlement and `GOOGLE_IOS_REVERSED_CLIENT_ID` build setting; the embedded Watch target owns neither. A real reversed client scheme, stable owned App ID, matching profiles and provider-console configuration belong to the hosted physical promotion step.

For Xcode builds, open the CocoaPods workspace, not the app project:

```bash
yarn workspace @repo/mobile ios:xcode
```

Opening `ios/Divenary.xcodeproj` directly can leave the Swift `AppDelegate` without the React pod modules (`React`, `React_RCTAppDelegate`, and `ReactAppDependencyProvider`).

The CLI `ios:build` is an unsigned simulator gate. Passing it does not prove Apple capability, provisioning, signed entitlements, Google callback configuration, or physical provider login.

## watchOS Companion

The watch app is embedded through the mobile iOS project instead of a standalone workspace. Keep watch source under `ios/DivenaryWatchApp`, and update target membership in `ios/Divenary.xcodeproj`.

The watch-only CLI build uses the project directly:

```bash
yarn workspace @repo/mobile watch:build
```

The watch target is not a separate Yarn workspace. Do not recreate a standalone watch workspace unless the project deliberately reverses this companion ownership decision.

## Android Setup

Android builds require Android Studio, Android SDK, `ANDROID_HOME`, and an emulator or connected device. The Gradle files are adjusted for this monorepo's hoisted root `node_modules`.

## Current Scope

The app currently includes local persistent Logbook/Planbook/settings storage, watch fixture import, runtime watch sync JSON validation, a WatchConnectivity receiver/import acknowledgement PoC, and the Wave 3A mobile Auth foundation: Keychain-compatible Supabase sessions, native Google/Apple credential adapters, guest-preserving login, and mandatory versioned terms/privacy consent.

Guest Logbook/Planbook data remains in the existing local repositories with `cloudSyncStatus: notConfigured`. Wave 3A login, consent, cancellation, logout, and restore do not claim, upload, delete, partition, or permanently hide those records. The Watch app has no account, provider, Auth entitlement, or Supabase responsibility.

Local database/Auth tests and unsigned simulator builds pass. Hosted Supabase/provider configuration, stable owned identifiers and signing, reviewed legal URLs, physical Google/Apple Auth/re-consent, and the post-Auth Watch regression remain a promotion gate. Remote data and infinite pagination (3B), principal partitions/guest claim/outbox (3C), account-local purge and immediate permanent account deletion (3D), real-device background delivery, and production dive-computer behavior are not implemented or verified. The app is not releasable before 3D adds in-app account deletion.
