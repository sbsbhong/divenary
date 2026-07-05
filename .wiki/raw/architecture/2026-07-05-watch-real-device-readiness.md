Source URL: docs/superpowers/specs/2026-07-05-watch-real-device-readiness-design.md; docs/superpowers/plans/2026-07-05-watch-real-device-readiness.md; apps/mobile/ios/DiveWatchApp; packages/contracts/schemas/watch-session.schema.json; apps/mobile/src/screens/logbook/log-entry-detail.tsx
Collected: 2026-07-05
Published: Unknown

# Watch real-device readiness and explicit demo mode

This source captures the repository implementation state after the real-device readiness pass on 2026-07-05.

Accepted product direction:

- Supported hardware should be Apple Watch Ultra-class hardware with underwater depth sensor support.
- Real device recording should use real sensor data.
- Fake data is allowed only in an explicit test/demo mode.
- The normal recording screen should be a depth-first instrument.
- The safety stop screen should take over only when the safety stop reminder is active, paused, or completed.
- Watch planning should not create or edit plans. It may only select unexecuted plans that came from the mobile app.

Implemented watch behavior:

- `RealDepthSensorProvider` now uses `CMWaterSubmersionManager` and emits samples from underwater depth/pressure measurements when `waterSubmersionAvailable` is true.
- `DemoDepthSensorProvider` owns simulated samples and is selected only through `WatchRecordingMode.demo`.
- `RecordingView` receives `WatchRecordingMode.real` or `.demo` and writes `DiveCaptureMode.real` or `.demo` into the saved record.
- Watch target `Info.plist` includes `NSMotionUsageDescription` and `WKBackgroundModes` with `underwater-depth`, enabling the app to request underwater auto-launch authorization for the supported session type.
- `DepthAutoLaunchAuthorization` calls `WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus` and surfaces active/inactive/unavailable status.
- `DepthSensorAvailability` reads `CMWaterSubmersionManager.waterSubmersionAvailable` and watch water resistance description. Real start actions are disabled when water submersion is unavailable; the demo action remains available.
- Watch Home no longer has watch-side plan editing fields. It shows scuba start, free session start, mobile-provided unexecuted plan selection, explicit demo, latest session, and saved sessions.
- Saved watch summary/list/detail screens mark demo captures with a small `Demo` pill.

Implemented mobile and contract behavior:

- `WatchSession` contract now has optional `captureMode` values `real` and `demo`.
- Generated TypeScript and Swift contracts include `captureMode`.
- Mobile runtime validation accepts only `real` or `demo` capture modes.
- Watch-to-mobile import preserves the raw watch session capture mode and marks imported mobile log entries as synced after local repository import, while preserving raw watch `syncStatus`.
- Mobile log detail displays a small `Demo` pill for demo watch captures.
- Large watch depth/temperature profiles render through an SVG path renderer with render-only downsampling, so 850-sample logs remain visible without creating one view per sample.

Implemented watch UI cleanup:

- Watch Home title is `Dive` and no longer has the oversized `Dive Watch` card.
- Watch Home has no watch-side plan creation/edit flow.
- Recording view reduces explanatory labels and card text, keeping large numeric depth/time values dominant.
- Scuba default view remains a depth-first instrument.
- Safety stop instrument appears only for active, paused-too-deep, paused-too-shallow, or completed states.
- Safety stop non-compliance is visualized with a warning band instead of explanatory status text like deeper/shallower than stop zone.
- The compact destructive end button is separated from live metrics and disclaimer text.

Remaining validation limits:

- The real sensor code compiles against the local watchOS SDK and watch simulator target, but underwater behavior has not been validated on physical Apple Watch Ultra hardware.
- `CMWaterSubmersionManager` temperature may arrive independently from depth measurements. The current watch sample model still requires a non-optional temperature value, so the provider uses a fallback before the first temperature update. This should be revisited before relying on temperature review quality.
- Store-level Ultra-only install filtering still needs App Store Connect / TestFlight validation. The code currently enforces the support boundary at runtime with `waterSubmersionAvailable` and watch target metadata.
- WatchConnectivity background delivery, auto-launch prompt behavior, and underwater launch handoff still need paired physical device validation.
- The app remains a supplemental log and reminder tool, not a certified dive computer, decompression computer, medical device, emergency system, or certified equipment replacement.
