Source URL: project conversation; docs/superpowers/specs/2026-07-12-pre-dive-readiness-immediate-work-design.md; local implementation
Collected: 2026-07-12
Published: 2026-07-12

# Pre-real-dive readiness scope and immediate hardening

The user has a physical iPhone and Apple Watch, but the watch app is not installed yet. Implementation and automated verification must finish before asking the user to run physical tests. The final physical matrix includes dry paired-device checks and shallow container or pool submersion with sensor confirmation. Actual freediving and scuba dives are excluded and remain a separate real-dive gate.

Every unresolved task that can be completed before an actual freedive or scuba dive is P0. P0 items are ordered in dependency waves rather than downgraded to lower priorities. Supabase, authentication, remote sync, Memory, and share work are included. Each substantial backlog item should receive its own spec before sequential implementation.

Immediate implementation completed in this change:

- Automatic event import and manual inbox drain now share one process-wide `WatchConnectivityImportCoordinator`. The same concurrent `payloadId` coalesces, distinct payloads serialize, and a failed operation does not block the queue.
- Watch `DepthSample.waterTemperatureCelsius` is optional. `RealDepthSensorProvider` no longer substitutes `0` before a temperature measurement arrives. Summaries average only available values, the live view keeps the latest measured value, and summary rows omit absent temperature.
- Mobile `DiveLogEntry` now separates `cloudSyncStatus` from raw Watch `session.syncStatus`. The persistent Logbook envelope is schema 3 under the existing `dive-app:logbook:v2` key. Every schema-2 mobile status migrates to `notConfigured`; raw Watch transfer provenance and mobile edits are preserved. Cloud filters and status pills are hidden until a backend exists.
- DEBUG builds expose deterministic `DiveSessionRecord.largeDebugFixture(sampleCount:)`. With `DIVE_WATCH_DEBUG_CONTROLS=1`, `Test Large Sync` saves an 8,000-sample demo record through `DiveSessionStore`, exercising the normal file-backed persistence and WatchConnectivity file-transfer path.

P0 dependency waves:

1. Dry physical-device install, pairing, connected/offline/reconnect import, duplicate delivery, acknowledgement, planned-dive round trip, background/killed behavior, notifications, and large file transfer.
2. Shallow container or pool submersion for depth, pressure, optional temperature, auto-launch, background handoff, wet controls, readability, and haptics. This is not an actual freedive or scuba dive.
3. Supabase/Auth foundation: account and guest-data decisions, local project/migrations, user-owned schema, RLS, generated types, client boundary, repositories, outbox/conflict behavior, backup, and media storage.
4. Product completion: Memory/share, attachments and export, Logbook review/search/filter polish, Planbook repeated-use flow, retry/status UX, accessibility, localization, and privacy controls.
5. Release and safety boundary: App Store/TestFlight hardware filtering, security/privacy review, release QA, and design-only decisions for external dive-computer imports or decompression terminology. The app does not calculate decompression obligations or provide life-critical underwater instructions.

Actual freediving/scuba validation, deep-water behavior, and safety-stop behavior under a real dive profile remain outside these waves as the final real-dive gate.
