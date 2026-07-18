# Watch Underwater Runtime Lifecycle Design

## Context

Real-device shallow water testing showed that Apple Watch's built-in Depth app reports approximately `0.1m` in a controlled bag/tank setup, while DivenaryWatch did not visibly react. The test also exposed that underwater touch controls are the wrong primary ending mechanism because Water Lock prevents tapping the current `End Dive` button.

Current implementation state:

- `RealDepthSensorProvider` uses `CMWaterSubmersionManager` for live depth, pressure, and optional temperature samples.
- `RecordingView` starts `DiveSessionRecorder` from explicit navigation and currently shows a surface-gated touch `End Dive` button.
- `HomeView` has an internal `DiveAutoStartMonitor` with a `3m` activation threshold.
- The watch `Info.plist` declares `WKBackgroundModes` with `underwater-depth`, but the project does not show a watch target entitlements file or `CODE_SIGN_ENTITLEMENTS` for `DivenaryWatchApp`.
- There is no Divenary-owned `WKExtendedRuntimeSession` controller and no app launch/runtime handoff path that starts recording when the app is selected in Settings > General > Auto-Launch > When Submerged.

Apple's relevant public behavior:

- The Depth app can start manually, via Action Button, or automatically when depth exceeds 1 meter and the watch has been submerged for more than 5 seconds.
- The Depth app ends manually by holding the Digital Crown after surfacing, via Action Button on Apple Watch Ultra when configured for Dive, or automatically after Apple Watch has been out of the water for 10 minutes.
- If the wearer descends again within 10 minutes without ending, the underwater time is added to the same dive.
- Apple developer documentation says `underwater-depth` lets an app remain frontmost during a dive, can add the app to the underwater auto-launch list, and that apps need the submersion data entitlement/setup. It also describes system auto runtime behavior around the `submergedDeep` state.

References:

- Apple Support, "Measure underwater temperature, duration, and depth on Apple Watch": https://support.apple.com/en-ca/guide/watch/apd9073c83d6/watchos
- Apple Developer, "Accessing submersion data": https://developer.apple.com/documentation/CoreMotion/accessing-submersion-data
- Apple Developer, `WKBackgroundModes`: https://developer.apple.com/documentation/BundleResources/Information-Property-List/WKBackgroundModes

## Decision

Real underwater recording must follow the Apple underwater extended runtime lifecycle.

Divenary will treat `WKExtendedRuntimeSession` as the lifecycle owner for real underwater recording and `CMWaterSubmersionManager` as the sample source. `DiveSessionRecorder` remains the Divenary recording/storage/sync owner, but it starts and stops in response to the runtime/submersion lifecycle rather than an underwater touch button.

Demo and debug-test recording do not use the underwater runtime lifecycle. They continue using `DemoDepthSensorProvider`, Digital Crown depth control, and a visible end button because they cannot satisfy real submersion, Water Lock, or 10-minute surface exit conditions.

## Goals

- Make Divenary eligible for the `When Submerged` auto-launch app list on supported Apple Watch hardware, subject to required Apple entitlements/provisioning.
- If Divenary is selected in `When Submerged`, opening the app through submersion should start a Divenary recording session without requiring a tap.
- Match Apple's three real-session ending paths:
  - hold Digital Crown after surfacing to turn off Water Lock and end immediately,
  - Action Button Dive ending on supported/configured Apple Watch Ultra,
  - automatic end after 10 minutes out of water.
- Preserve the "descend again within 10 minutes continues the same dive" behavior.
- Remove the real underwater touch `End Dive` button and replace it with compact instructional copy.
- Keep demo/debug workflows usable with the existing end button.
- Smooth the displayed ascent-rate value so small shallow-water movement does not create rapid spikes, while preserving raw samples.

## Non-Goals

- No decompression obligation, tissue loading, NDL, ceiling, gas-switching safety, emergency decision, or certified dive-computer behavior.
- No claim that Divenary is a certified depth gauge, dive computer, medical device, or emergency system.
- No in-app fake `WKExtendedRuntimeSession` or fake submersion API. Development simulation remains outside production app behavior.
- No attempt to override system Water Lock interaction rules.
- No cloud, Supabase, mobile logbook, or WatchConnectivity redesign.
- No release claim that physical underwater behavior is verified beyond explicitly documented manual tests.

## Architecture

### Runtime Session Controller

Add a watch-only runtime coordinator, tentatively `DiveRuntimeSessionController`, responsible for:

- Creating and starting `WKExtendedRuntimeSession` for real recording when the app is active and a real session is manually started.
- Handling runtime session delegate callbacks and errors.
- Accepting or recovering system-started underwater runtime behavior when the app is launched by `When Submerged`.
- Observing `CMWaterSubmersionEvent` state transitions from the real sensor provider or a shared submersion coordinator.
- Publishing a small state model that `HomeView`/`RecordingView` can use to navigate into recording, show lifecycle status, and stop/save the session.

The controller must not own sampled profile persistence. It coordinates lifecycle only. `DiveSessionRecorder` remains responsible for sample append, engine updates, profile artifact writing, final payload normalization, and record creation.

### Sensor Provider Boundary

`RealDepthSensorProvider` should stop being the only owner of the Core Motion manager. Introduce a small `WaterSubmersionCoordinator` that owns a single `CMWaterSubmersionManager` and fan-outs samples/events. This avoids separate manager instances and keeps the runtime lifecycle and sample stream aligned.

The coordinator exposes clear outputs:

- depth samples to `DiveSessionRecorder`,
- submersion/runtime events to `DiveRuntimeSessionController`.

### Recording Start

Manual real start:

1. User taps `Free Session Start`, `Scuba Start`, or a planned dive.
2. Home updates `preferredDiveMode` exactly as it does today.
3. `RecordingView` starts real recording and asks `DiveRuntimeSessionController` to start or attach to an underwater runtime session.
4. `DiveSessionRecorder` starts immediately with the selected `PreDivePlan`.
5. Samples append only when Core Motion emits valid submersion measurements.

Auto-launch real start:

1. User has selected Divenary in Settings > General > Auto-Launch > When Submerged.
2. watchOS launches or foregrounds Divenary when the submerged condition is met.
3. Divenary initializes its real submersion coordinator early enough to receive event/measurement callbacks.
4. The runtime controller starts recording with the last selected `preferredDiveMode`.
5. If a planned dive had been selected before launch, its `PreDivePlan` is used; otherwise Divenary builds an explicit start plan for the preferred mode.

The current internal `3m` auto-start threshold should not remain the primary automatic start criterion. Apple's underwater launch/deep-submersion behavior is the real criterion. If a fallback monitor remains, it must use Apple-aligned thresholds and must not conflict with system auto-launch.

### Recording End

For `real` mode, remove the touch `End Dive` button. Stop/save is triggered by runtime lifecycle:

- Water Lock off / Digital Crown hold after surfacing: stop the active recorder, build the session record, show Summary.
- Action Button Dive end: same stop/save path if watchOS reports the runtime invalidation/end event.
- Out of water for 10 minutes: stop the active recorder automatically, build the session record, show Summary or save pending summary state.

If the wearer returns underwater before the 10-minute surface timeout, keep the same recorder active and continue appending samples to the same session. Do not split into a second Divenary session.

If runtime invalidation occurs without enough samples, still end deterministically:

- If there are valid samples, build the best available record.
- If there are no valid samples after a manual start, show a compact "No depth samples captured" summary state and do not save a log.
- If there are no valid samples after an auto-launched attempt that never reached a recording-worthy depth state, cancel silently and return to Home.

### Demo And Debug Exceptions

`demo` and `debugTest` remain separate from real runtime behavior:

- Use `DemoDepthSensorProvider`.
- Keep Digital Crown depth control.
- Keep the visible end button.
- Preserve Demo/Test markers in watch and mobile sync payloads.
- Do not request underwater runtime session.
- Do not require Water Lock, 10-minute surface timeout, or supported underwater hardware.

This preserves testability and avoids pretending that `WKExtendedRuntimeSession` has a production in-app demo API.

## Watch UI

### Real Recording

The real recording screen remains instrument-first:

- Left depth rail.
- Right live values.
- No cards inside the recording instrument.
- No large explanatory banner.
- No touch end button.

Replace the button with compact helper copy:

> 즉시 다이빙을 종료하려면 물 밖에서 Digital Crown을 길게 누르세요.

Layout constraints:

- Use 10-11 pt muted text.
- Limit to 2 lines.
- Apply `minimumScaleFactor`.
- Place near the bottom of the right-side value column or under the live metrics, not over the depth rail.
- Keep current depth, elapsed time, max depth, safety-stop reminder, and unsupported-depth warning visually higher priority.
- Do not add a dismissible card, modal, or large instruction block.

The wording must remain instruction about ending the recording only. It must not imply ascent permission, emergency guidance, decompression status, or certified safety state.

### Demo/Debug Recording

Demo/debug shows the existing end button because the user must be able to finish a simulated session. The button may keep the current compact style. It should remain visually associated with the Demo/Test badge so users do not confuse this with the real underwater path.

## Auto-Launch Eligibility And Diagnostics

Implementation must verify both project metadata and signed build output:

- `WKBackgroundModes` includes `underwater-depth` in the watch app `Info.plist`.
- The watch target has the required Apple submersion entitlement configured in build settings/provisioning.
- Signed watch app entitlements contain the expected submersion entitlement.
- The embedded provisioning profile contains the expected submersion entitlement.
- Add `WKSupportsAutomaticDepthLaunch` only if current Apple tooling/watchOS behavior or signed-build inspection shows it is required for `When Submerged` listing. Do not treat it as a substitute for entitlement/provisioning.
- `WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus` still feeds compact status copy on Home.

If the app still does not appear in `When Submerged`, the blocker should be reported as signing/provisioning/App Store capability state, not hidden behind UI.

## Ascent Rate Display

Current ascent-rate display is an instantaneous two-sample calculation:

`(previous.depthMeters - current.depthMeters) / elapsedSeconds * 60`

This is expected to spike in shallow water when the watch moves, then immediately return to `0` when the next sample is flat or deeper.

Change display ascent rate to a smoothed reference value:

- Preserve raw samples exactly.
- Keep persisted profile samples unchanged unless a later implementation explicitly adds derived metadata.
- Compute UI ascent rate from a short recent window, preferably 3-5 seconds or from finalized 1Hz buckets.
- Apply a small depth-change deadband, initially `0.1m` to `0.2m`, so tiny shallow-water movement does not show as meaningful ascent.
- Clamp invalid, negative, or non-finite values to `0`.
- Keep enough responsiveness that a real rapid ascent is not hidden by excessive smoothing.

This value remains a non-certified reference. UI copy and tests must continue to avoid "safe to ascend", "상승 가능", "이제 안전합니다", "감압 완료", "deco clear", and equivalent safety guarantees.

## Testing

Automated tests:

- Runtime controller unit tests with fake runtime events:
  - manual start creates active lifecycle state,
  - Water Lock/runtime invalidation ends and saves,
  - 10-minute surface timeout ends,
  - resubmersion before 10 minutes keeps the same session,
  - no-sample runtime end cancels or shows no-sample state deterministically.
- Recording mode tests:
  - `real` uses runtime lifecycle and no touch end button,
  - `demo`/`debugTest` do not request runtime lifecycle and keep end button.
- Ascent smoothing tests:
  - tiny jitter does not spike,
  - sustained ascent produces a positive smoothed value,
  - flat/deeper samples return `0`,
  - non-finite samples are ignored or clamped.
- Watch UI language guard continues to reject safety-guarantee phrases.

Manual real-device tests:

- Build and inspect signed watch entitlements.
- Confirm Divenary appears in Settings > General > Auto-Launch > When Submerged on supported hardware after the required entitlement/provisioning is active.
- Select Divenary in `When Submerged`, submerge using a safe shallow setup or Xcode Easy Submersion, and confirm app launch and recording start.
- Confirm Water Lock behavior and Digital Crown hold ends the recording after surfacing.
- Confirm Action Button Dive ending if available/configured.
- Confirm out-of-water 10-minute automatic end.
- Confirm resubmersion within 10 minutes continues the same session.
- Confirm demo/debug still start, adjust depth by Crown, and end by button.
- Confirm 41mm/45mm/Ultra layouts do not clip current depth, metrics, or the new helper copy.

Verification commands:

- `yarn watch:build`
- If project metadata or architecture docs are changed with implementation, `yarn codex:check`

## Risks

- Apple submersion entitlements may require developer account capability approval or provisioning updates outside the repository.
- The app may still not appear in `When Submerged` until signed with the right entitlement even if local `Info.plist` and code are correct.
- Runtime invalidation callbacks may not map one-to-one to the visible Water Lock UX; this must be validated on hardware.
- Easy Submersion is a development aid, not proof of real underwater behavior.
- Smoothing ascent rate improves readability but must not be framed as safety-critical truth.

## Implementation Decisions

- Use `WaterSubmersionCoordinator` as the single `CMWaterSubmersionManager` owner for real mode.
- Manual no-sample ends show a no-sample summary and do not save.
- Clearly abandoned auto-launched no-sample attempts cancel silently.
- `WKSupportsAutomaticDepthLaunch` is a conditional compatibility key, not a primary capability. Entitlement/provisioning remains the primary eligibility requirement.
