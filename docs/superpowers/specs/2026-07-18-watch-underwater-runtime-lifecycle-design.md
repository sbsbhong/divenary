# Watch Underwater Runtime Lifecycle Design

## Context

Real-device shallow-water testing showed that Apple Watch's built-in Depth app reports approximately `0.1m` in a controlled 15cm bag/tank setup, while DivenaryWatch did not visibly react. The test also exposed that underwater touch controls are the wrong primary ending mechanism because Water Lock prevents tapping the current `End Dive` button.

Current implementation state:

- `RealDepthSensorProvider` owns a `CMWaterSubmersionManager` and emits depth, pressure, and optional temperature samples.
- `RecordingView` owns `DiveSessionRecorder`, starts recording from `onAppear`, and currently shows a surface-gated touch `End Dive` button.
- `HomeView` owns a second real sensor provider through `DiveAutoStartMonitor` and uses a `3m` activation threshold.
- The watch `Info.plist` declares `WKBackgroundModes` with `underwater-depth`, but the watch target has no entitlements file and no `CODE_SIGN_ENTITLEMENTS` setting.
- The app has no `WKApplicationDelegate` handoff for a system-created extended runtime session and no App Intent support for the Apple Watch Ultra Action Button.

Verified Apple behavior and API contracts:

- The `underwater-depth` background mode makes an app eligible for underwater auto-launch and keeps it frontmost. If the app does not explicitly start a runtime session, watchOS can create one when the watch reaches `submergedDeep`, which begins below approximately 1 meter.
- A manually started underwater `WKExtendedRuntimeSession` automatically enables Water Lock.
- An underwater runtime session ends when the app invalidates it, the wearer turns off Water Lock, or the watch remains `notSubmerged` for more than 10 minutes.
- `WKApplicationDelegate.handle(_:)` receives a system-created or recovered runtime session. The app must assign the session delegate before that callback returns or watchOS ends the session.
- The public runtime API does not expose a separate "Digital Crown unlocked" callback. Divenary observes the resulting runtime invalidation.
- A third-party dive app does not receive an Action Button end event automatically. It must implement `StartDiveIntent`, donate a next `AppIntent`, and route that next action to its own end path.
- `CMWaterSubmersionManager` requires a depth-and-pressure entitlement for samples. The public Shallow Depth and Pressure capability is limited to the manager's authorized maximum depth; deeper access requires Apple's managed entitlement.

The 15cm setup can verify a manually started Divenary session and shallow sensor updates after entitlement/signing is correct. It cannot verify `When Submerged` auto-launch, because the system's automatic runtime criterion is around `submergedDeep`, not a 10-15cm shallow reading. Auto-launch requires a controlled depth greater than 1 meter or Xcode Easy Submersion on a paired device.

References:

- Apple Support, "Log your underwater activity with the Depth app on Apple Watch": https://support.apple.com/en-nz/guide/watch/apdd1a0ae6f4/watchos
- Apple Developer, "Accessing submersion data": https://developer.apple.com/documentation/CoreMotion/accessing-submersion-data
- Apple Developer, `WKApplicationDelegate.handle(_:)`: https://developer.apple.com/documentation/watchkit/wkapplicationdelegate/handle(_:)-7kiwx
- Apple Developer, "Responding to the Action button on Apple Watch Ultra": https://developer.apple.com/documentation/AppIntents/ActionButtonArticle
- Apple Developer, `WKBackgroundModes`: https://developer.apple.com/documentation/BundleResources/Information-Property-List/WKBackgroundModes

## Decision

Real underwater recording follows the Apple underwater extended runtime lifecycle.

Divenary treats `WKExtendedRuntimeSession` as the lifecycle owner for a real underwater session and `CMWaterSubmersionManager` as the sample and submersion-state source. An app-scoped `RealDiveSessionCoordinator` joins those system objects to `DiveSessionRecorder`, which remains responsible for sample processing, profile persistence, record construction, and sync-ready output.

Demo and debug-test recording remain local view-scoped flows. They use `DemoDepthSensorProvider`, Digital Crown depth control, and a visible end button. They never request, fake, or depend on a real underwater runtime session.

## Goals

- Make the signed Divenary watch app eligible for `When Submerged` on supported hardware.
- Start a Divenary real recording without a tap when watchOS launches Divenary as the selected underwater app.
- Preserve the last selected `DiveMode` as the automatic and Action Button start mode.
- Match the three requested real-session ending paths:
  - hold Digital Crown after surfacing, causing Water Lock to turn off and the underwater runtime to invalidate,
  - press the Action Button after surfacing when Divenary is configured as the Dive app and the session is eligible to end,
  - let watchOS invalidate the runtime after more than 10 minutes continuously out of water.
- Preserve the same session when the wearer submerges again before the system's 10-minute end condition.
- Remove the real-session touch end button and replace it with compact instructional copy.
- Keep demo/debug sessions independently startable and endable.
- Stabilize the live ascent-rate display without changing raw or persisted profile samples.

## Non-Goals

- No decompression obligation, tissue loading, NDL, ceiling, gas-switching safety, emergency decision, or certified dive-computer behavior.
- No claim that Divenary is a certified depth gauge, dive computer, medical device, or emergency system.
- No in-app fake `WKExtendedRuntimeSession` or fake submersion API. Unit-test fakes remain behind test-only protocols; device simulation uses Xcode Easy Submersion.
- No attempt to programmatically turn Water Lock off.
- No cloud, Supabase, mobile logbook, contract schema, or WatchConnectivity redesign.
- No persistence of a selected planned dive solely for automatic launch. Automatic and Action Button starts use the persisted mode, not an implicitly selected plan.
- No claim that the existing 40m product target is enabled by the shallow entitlement. Full-depth access remains an external managed-entitlement gate.
- No release claim that physical underwater behavior is verified beyond explicitly recorded manual tests.

## Architecture

### App-Scoped Composition

Add a watch-only composition root, `DiveAppServices`, created before SwiftUI navigation and shared by system entry points. It owns:

- the existing `DiveSessionStore`,
- one `WaterSubmersionCoordinator`,
- one `DiveRuntimeSessionController`,
- one `RealDiveSessionCoordinator` and its real `DiveSessionRecorder`.

`DivenaryWatchApp` uses `@WKApplicationDelegateAdaptor` with `DivenaryWatchApplicationDelegate`. The application delegate forwards `handle(_ extendedRuntimeSession:)` synchronously to `DiveAppServices`. The runtime controller assigns itself as the runtime delegate before the application-delegate callback returns.

The same app-scoped coordinator is registered with `AppDependencyManager` for Action Button intents. This avoids separate runtime, recorder, and sensor objects being created by SwiftUI navigation, auto-launch, and App Intents.

### Runtime Session Controller

`DiveRuntimeSessionController` is responsible only for `WKExtendedRuntimeSession` ownership and delegate translation.

It supports two starts:

- `startManualSession()`: create a new runtime session, assign the delegate, retain it, and call `start()` while the app is active.
- `adoptSystemSession(_:)`: retain the session supplied through `WKApplicationDelegate.handle(_:)` and assign the delegate synchronously. Do not call `start()` on the supplied session.

It publishes normalized events to `RealDiveSessionCoordinator`:

- `adoptedSystemSession`, emitted only after the supplied session delegate is attached,
- `didStart`,
- `willExpire`,
- `didInvalidate(reason:error:)`.

The coordinator starts automatic recording from `adoptedSystemSession` rather than waiting for
`didStart`, because a session supplied to `WKApplicationDelegate.handle(_:)` may already be
running and is not required to emit a second start callback after adoption.

It exposes `invalidate()` for Divenary-owned Action Button ending. It does not own profile samples, create a 10-minute timer, or infer that a single `notSubmerged` event ends a dive. The watchOS underwater runtime owns the Water Lock and 10-minute rules.

Production code wraps runtime creation and invalidation behind a small protocol so unit tests can send deterministic lifecycle events without pretending a fake runtime is a production feature.

### Water Submersion Coordinator

`WaterSubmersionCoordinator` is the only production owner of `CMWaterSubmersionManager`.

It starts monitoring during app-service initialization on supported hardware and keeps the manager delegate attached while the app is alive. It publishes:

- valid `DepthSample` values,
- normalized `CMWaterSubmersionEvent.State` values,
- measurement depth states such as `submergedShallow`, `submergedDeep`, and sensor error,
- Core Motion errors,
- the manager's authorized `maximumDepth` when available.

`RealDepthSensorProvider` becomes a lightweight adapter over this coordinator. Starting or stopping a recorder subscribes or unsubscribes that recorder from samples; it does not create a second manager or disable app-level submersion monitoring.

### Real Recording Coordinator

`RealDiveSessionCoordinator` owns the state machine that joins runtime and recording behavior. It retains one reusable real `DiveSessionRecorder` and publishes an app-navigation state such as idle, recording, pending summary, no-sample result, or failed start.

It also records a start source:

- manual touch start,
- system underwater auto-launch,
- Action Button start.

All end signals pass through one idempotent finalization method. Duplicate runtime callbacks or repeated Action Button requests must not create multiple records or summaries.

### Recording Start

Manual real start:

1. The user taps `Free Session Start`, `Scuba Start`, or a planned dive.
2. Home persists the chosen mode as it does today.
3. `RealDiveSessionCoordinator` starts the recorder with that explicit `PreDivePlan` and asks the runtime controller to start a manual underwater runtime.
4. Runtime start enables Water Lock; valid Core Motion samples flow through the shared coordinator.
5. SwiftUI navigation reacts to coordinator state and presents the real recording screen.

System auto-launch start:

1. The user selects Divenary in Settings > General > Auto-Launch > When Submerged.
2. When watchOS reaches its underwater launch criterion, it launches or foregrounds Divenary and supplies a runtime session through `WKApplicationDelegate.handle(_:)`.
3. Divenary assigns the runtime delegate before `handle(_:)` returns.
4. `RealDiveSessionCoordinator` starts the recorder with a default `PreDivePlan` built from `DiveSessionStore.preferredDiveMode`. Scuba defaults keep the existing `Air` label behavior.
5. Home navigation presents the same real recording screen used by a manual start.

Action Button start:

1. `DivenaryStartDiveIntent: StartDiveIntent` makes Divenary selectable as the Apple Watch Ultra Dive app.
2. Its `perform()` method starts a real session through the app-scoped coordinator using the persisted preferred mode.
3. The intent result donates `DivenaryEndDiveIntent` as the next Action Button action.
4. Manual and system auto-launched sessions also donate the same next action. watchOS uses it only when Divenary is configured as the Action Button Dive app.

Both intents live directly in the watch app target, not an App Intents extension. Divenary does not override the
`StartDiveIntent` default foreground-launch behavior.

Remove `DiveAutoStartMonitor` and its `3m` threshold. It is neither the system auto-launch criterion nor a reliable fallback, and it creates a second live Core Motion manager.

### Recording End

For real mode, no touch end button is present.

Digital Crown after surfacing:

1. The wearer holds Digital Crown to turn off Water Lock.
2. watchOS invalidates the underwater runtime.
3. The runtime delegate forwards invalidation to `RealDiveSessionCoordinator`.
4. The coordinator finalizes the recorder once and presents the summary.

Action Button:

1. `DivenaryEndDiveIntent` asks the app-scoped coordinator to end.
2. To match the Depth app's surfaced ending semantics, Divenary accepts the request only while the latest event is `notSubmerged` and elapsed recording time is at least 3 minutes. An in-water or too-early press leaves the session active and keeps the end intent donated.
3. An accepted request calls `WKExtendedRuntimeSession.invalidate()`.
4. The normal runtime invalidation callback performs the same single finalization path as Digital Crown ending.

Automatic end:

1. A `notSubmerged` event updates UI/coordinator state but does not stop recording.
2. If the watch remains out of water for more than 10 minutes, watchOS invalidates the underwater runtime.
3. The runtime invalidation callback performs the same finalization path.
4. If the watch submerges again before invalidation, the existing runtime and recorder continue. Divenary creates no second session and runs no competing timer.

Runtime error or no samples:

- If at least one valid depth sample was captured, finalize the best available record and present Summary even when the runtime ends with an error.
- If a manual or Action Button start ends without a valid sample, cancel the active profile artifact, show a compact `No depth samples captured` result, and do not save a log.
- If a system auto-launched attempt ends without a valid sample, cancel it silently and return to Home.

Summary completion:

- Saving finalizes the profile artifact first; the coordinator returns to idle only after storage reports success.
- Discarding clears the active profile journal before returning to idle, so a discarded summary cannot reappear later as an interrupted recovery.

### Demo And Debug Exceptions

`demo` and `debugTest` remain separate from real runtime behavior:

- Use `DemoDepthSensorProvider` owned by the simulated recording view.
- Keep Digital Crown depth control.
- Keep `SurfaceEndDiveGate` and the compact `End Dive` button for demo/debug only.
- Preserve Demo/Test markers in watch and mobile sync payloads.
- Do not access `DiveRuntimeSessionController`, `WaterSubmersionCoordinator`, App Intent ending, Water Lock, or the 10-minute rule.

## Watch UI

### Real Recording

The real recording screen remains instrument-first:

- left depth rail,
- right live values,
- no cards inside the recording instrument,
- no large explanatory banner,
- no touch end button.

Replace the real button with localized compact helper copy:

> 즉시 다이빙을 종료하려면 물 밖에서 Digital Crown을 길게 누르세요.

Layout constraints:

- Render the helper in a stable control row between the live instrument and the existing disclaimer instead of a floating overlay.
- Align it to the right-value column by reserving the rail width on the leading side.
- Use 10pt muted text, at most 2 lines, and `minimumScaleFactor(0.75)`.
- Keep the row height bounded so 41/42mm, 45/46mm, and 49mm layouts do not push depth, elapsed time, max depth, reminder state, or unsupported-depth warning off-screen.
- Keep the existing disclaimer visually subordinate but readable.

The text explains recording termination only. It must not imply ascent permission, emergency guidance, decompression status, or certified safety state.

### Demo And Debug Recording

Demo/debug uses the same bounded control-row slot for the compact end button. The Demo/Test marker remains visible so the touch ending path cannot be mistaken for real underwater behavior. Its existing surface gate remains active.

### No-Sample Result

After Water Lock is already off, a manual no-sample result may show one compact message and a single `Done` action. It must not construct or save an empty `DiveSessionRecord`.

## Auto-Launch Eligibility And Signing

Repository metadata and signed-device state are separate checks.

Repository changes:

- Keep `WKBackgroundModes` with `underwater-depth` in the watch app `Info.plist`.
- Add a watch target entitlements file and configure `CODE_SIGN_ENTITLEMENTS` for Debug and Release.
- Use Xcode's public Shallow Depth and Pressure capability (`com.apple.developer.submerged-shallow-depth-and-pressure`) for the first shallow-device implementation. This unblocks the 15cm/manual and <=6m development path without claiming 40m authorization.
- Read `CMWaterSubmersionManager.maximumDepth` and use it as the watch's active sensor authorization limit when available.
- Do not add `WKSupportsAutomaticDepthLaunch`; it is not part of the public setup documented by Apple and does not appear in the installed SDK.

External signing gate:

- The App ID and provisioning profile must include the same shallow capability for a signed device build.
- A future 40m build requires approval and provisioning for Apple's managed Submerged Depth and Pressure entitlement. Until then, Divenary must not present the shallow-signed build as 40m sensor-authorized.
- Inspect the signed watch app's `Info.plist`, code-signing entitlements, and embedded provisioning profile. A simulator build with `CODE_SIGNING_ALLOWED=NO` cannot prove this gate.
- Confirm the watch app is installed, reinstall after capability changes, and verify that the installed build contains `underwater-depth` before diagnosing a missing `When Submerged` list entry.
- Continue showing compact `requestAutoLaunchAuthorizationStatus` output on Home. `.active` means Divenary is the selected default responder; `.inactive` does not mean the sensor entitlement is valid.

If Divenary still does not appear after signed metadata and installation are verified, record the exact hardware, watchOS version, app version, authorization status, and provisioning evidence. Do not hide the failure behind generic UI copy.

## Live Ascent Rate Display

The current live value is calculated from two adjacent raw callbacks:

`(previous.depthMeters - current.depthMeters) / elapsedSeconds * 60`

At roughly three callbacks per second, a small upward movement is multiplied into a large per-minute number. The next flat or deeper callback immediately evaluates to `0`, which explains the observed rapid spike-and-zero behavior.

Introduce `DisplayAscentRateEstimator` for the live recording UI:

- Keep valid recent samples for at most 5 seconds.
- Do not produce a rate until the oldest and newest usable samples span at least 3 seconds.
- Compute the net upward depth change across that window, not a sum of adjacent positive movements.
- Return `0` when the net upward change is `0.15m` or less, the newest point is flat/deeper relative to the window start, timestamps are non-increasing, or any input is invalid/non-finite.
- Otherwise return `(netDepthDecrease / elapsedSeconds) * 60`.
- Feed `DiveSessionRecorder.latestAscentRateMetersPerMinute` and its transient warning flag from this estimator.

This pass deliberately leaves raw Core Motion callbacks, 1Hz persisted profile samples, sync contracts, and historical stored ascent fields unchanged. The displayed value remains a non-certified reference.

## Testing

Automated tests:

- `DiveRuntimeSessionControllerTests` with a fake runtime adapter:
  - manual start assigns delegate before start,
  - system adoption assigns delegate without calling start and emits `adoptedSystemSession`,
  - invalidation is forwarded once,
  - explicit Action Button invalidation calls the runtime once.
- `RealDiveSessionCoordinatorTests`:
  - manual, system, and Action Button starts use the intended plan/source,
  - system start uses the persisted preferred mode,
  - runtime invalidation with samples creates one pending summary,
  - `notSubmerged` alone does not end,
  - resubmersion before runtime invalidation keeps the same recorder/session,
  - manual no-sample end shows a no-sample result without saving,
  - automatic no-sample end returns silently to idle,
  - duplicate invalidation does not duplicate finalization,
  - failed summary persistence remains present for retry and discard clears its active journal.
- `DiveActionButtonIntentTests` through an injectable action bridge:
  - first press starts using the preferred mode and donates the end action,
  - underwater or under-3-minute end requests do not invalidate,
  - surfaced eligible requests invalidate once.
- `WaterSubmersionCoordinatorTests` for conversion of sample, event, error, and maximum-depth values through testable pure helpers.
- Recording mode/UI policy tests:
  - `real` uses the app-scoped lifecycle and has helper text but no touch end action,
  - `demo`/`debugTest` never request runtime lifecycle and retain `SurfaceEndDiveGate` plus the end button.
- `DisplayAscentRateEstimatorTests`:
  - 0.1m jitter stays at zero,
  - no value is emitted before a 3-second span,
  - sustained ascent produces a finite positive rate,
  - flat/deeper, out-of-order, and non-finite inputs produce zero without corrupting later samples.
- Existing watch UI language guard continues to reject safety-guarantee phrases.

Automated commands:

- Watch unit tests on an installed simulator: `xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData test`
- Watch compile gate: `yarn watch:build`
- Repository handoff gate after native and wiki changes: `yarn codex:check`

Manual real-device tests:

- Inspect the signed watch bundle and profile for the expected shallow entitlement and `underwater-depth` mode.
- Reinstall the watch app and confirm Divenary appears in Settings > General > Auto-Launch > When Submerged.
- In the 15cm setup, manually start a real session and confirm a value near `0.1m` appears and Water Lock activates.
- Verify that the 15cm setup does not falsely count as a successful automatic-launch test.
- Use Xcode Easy Submersion or a safely controlled depth greater than 1 meter to verify system auto-launch, `handle(_:)`, preferred-mode recording start, and the same real recording UI.
- Surface and hold Digital Crown; confirm exactly one summary appears.
- Configure Divenary as the Action Button Dive app; verify first press start and surfaced eligible next-press ending.
- Remain out of water for more than 10 minutes; confirm system-driven automatic ending.
- Resubmerge before 10 minutes; confirm the same local session ID continues.
- Confirm demo/debug still start, adjust depth by Crown, reveal the surface-gated end button, and finish without Water Lock.
- Check 42mm, 46mm, and 49mm layouts for clipping or overlap of depth, metrics, helper/button row, and disclaimer.

## Implementation Plan Split

The work is split into two implementation plans because ascent smoothing is independent from runtime, signing, auto-launch, Action Button, and recording navigation:

1. Watch underwater runtime lifecycle: entitlement/signing metadata, app-scoped services, shared submersion manager, runtime handoff, real recording state machine, Action Button intents, real/demo end UI, and physical-device checklist.
2. Watch live ascent-rate smoothing: estimator, recorder integration, focused tests, and display verification.

Each plan must leave the watch app buildable and independently testable.

## Risks

- `underwater-depth` should make the installed app an auto-launch candidate, but stale installation, wrong target metadata, hardware/watchOS support, or signing state can still obscure the list entry.
- The shallow capability only authorizes the public shallow range. The product's 40m target remains blocked until Apple grants and provisions the managed entitlement.
- Runtime invalidation reasons do not name the visible Digital Crown gesture. The device test must verify that Water Lock removal reaches the expected delegate path.
- Action Button behavior depends on the user selecting Divenary as the Dive app and on successful next-action donation.
- Easy Submersion validates system integration but is not proof of physical underwater behavior.
- The app-scoped real recorder must survive SwiftUI navigation changes without `onDisappear` canceling an active runtime session.
- Smoothing improves readability but does not make ascent data safety-certified.

## Implementation Decisions

- Use `DiveAppServices` as the single composition root for store, real sensor, runtime, and real recording coordination.
- Use `WaterSubmersionCoordinator` as the only production `CMWaterSubmersionManager` owner.
- Receive system-created sessions through `WKApplicationDelegate.handle(_:)` and assign the runtime delegate before returning.
- Remove the internal `3m` `DiveAutoStartMonitor`; do not replace it with an app timer or depth threshold.
- Let watchOS own Water Lock removal and the continuous 10-minute out-of-water timeout.
- Implement Action Button start/end through `StartDiveIntent` plus a donated next `AppIntent`.
- Use the public shallow entitlement first and treat full 40m entitlement as an external release gate.
- Automatic and Action Button starts use only the persisted last selected mode, not a persisted planned-dive selection.
- Manual/Action Button no-sample ends show a no-sample result; system auto-launch no-sample attempts cancel silently.
- Keep demo/debug recorder ownership and touch ending separate from all real runtime services.
- Implement live ascent smoothing in a separate focused plan and leave persisted profile data unchanged.
