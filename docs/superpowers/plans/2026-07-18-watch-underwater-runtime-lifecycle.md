# Watch Underwater Runtime Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real Divenary watch recordings follow the Apple underwater extended-runtime lifecycle, including signed shallow-depth eligibility, system `When Submerged` adoption, Digital Crown/Action Button/system-timeout endings, and a separate touch-end path for demo/debug sessions.

**Architecture:** `DiveAppServices` is the watch process composition root. It owns one long-lived `WaterSubmersionCoordinator`, one `DiveRuntimeSessionController`, and one `RealDiveSessionCoordinator` with a reusable real recorder. `WKApplicationDelegate` and App Intents route into those same services; SwiftUI observes coordinator state instead of owning a real runtime. Demo/debug recorders remain view-scoped and never touch the underwater runtime.

**Tech Stack:** Xcode 26.6 Swift compiler in the existing Swift 5 language mode (`SWIFT_VERSION = 5.0`), SwiftUI, Combine, WatchKit, Core Motion, App Intents, XCTest, Xcode project build settings, watchOS 10+.

## Global Constraints

- Divenary remains a recreational logging and post-dive review companion, not a certified dive computer, depth gauge, decompression computer, medical device, life-support system, or emergency decision system.
- Do not add decompression, tissue-loading, NDL, ceiling, gas-switching, emergency, or ascent-permission behavior.
- Let watchOS own Water Lock removal and the continuous out-of-water timeout. Do not add an app-side 10-minute timer or end a recording from one `notSubmerged` event.
- Never attempt to turn Water Lock off programmatically.
- `CMWaterSubmersionManager` has exactly one production owner. Remove the current `DiveAutoStartMonitor` and do not replace its `3m` threshold.
- A system-supplied `WKExtendedRuntimeSession` must have its concrete delegate assigned before `WKApplicationDelegate.handle(_:)` returns. Do not call `start()` on an adopted session.
- Keep Action Button intents directly in the watch app target and do not override `StartDiveIntent.openAppWhenRun`; the system intent's default foreground behavior is required.
- Real recording has no touch end action. Demo and debug-test recording retain `SurfaceEndDiveGate`, Digital Crown depth control, and a visible touch end action.
- Automatic and Action Button starts use only `DiveSessionStore.preferredDiveMode`; they do not persist or infer a selected planned dive.
- Add only the public shallow entitlement in this pass. Treat deeper managed entitlement approval and provisioning as an external release gate.
- Do not add `WKSupportsAutomaticDepthLaunch`; it is not a public watchOS setup key in the installed SDK.
- Keep `WKBackgroundModes = underwater-depth`, the existing sync contract, one-hertz profile persistence, and historical session payload fields unchanged.
- Do not claim physical-device success from a simulator build. A 15cm test validates only manually started shallow sampling; it does not validate `When Submerged` automatic launch.
- Preserve unrelated worktree changes. Use Yarn `1.22.22`; do not create npm, pnpm, or bun lockfiles.

## Baseline And Review Corrections

- The pre-change Watch XCTest baseline is `80` tests with `0` failures on `Apple Watch Ultra 3 (49mm)`.
- `WKExtendedRuntimeSession` has no demo API. Production uses the real API; unit tests use adapter protocols, and device simulation uses Xcode Easy Submersion.
- The system session adoption path emits an explicit `adoptedSystemSession` event after attaching the concrete delegate. The coordinator must not wait for another `didStart` callback from a session that may already be running.
- Action Button support is an App Intents flow: `StartDiveIntent` returns or donates `DivenaryEndDiveIntent` as the next action. It is not a generic runtime callback.
- Summary discard must clear the active profile artifact. Summary save must clear it only after `DiveSessionStore.save` succeeds.

## File Structure

### Runtime And Sensors

- Create `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveRuntimeSessionController.swift`: testable runtime adapters, event normalization, manual start, system adoption, and invalidation.
- Create `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`: real recording state machine and idempotent finalization.
- Create `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveActionButtonIntents.swift`: start/end intents, dependency bridge, and end-action donation.
- Create `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`: one process-scoped object graph.
- Create `apps/mobile/ios/DivenaryWatchApp/Runtime/DivenaryWatchApplicationDelegate.swift`: synchronous system runtime handoff.
- Create `apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift`: sole production `CMWaterSubmersionManagerDelegate`.
- Modify `apps/mobile/ios/DivenaryWatchApp/Sensors/RealDepthSensorProvider.swift`: adapt the shared water coordinator to `DepthSensorProvider`.
- Modify `apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift`: expose valid-sample presence and make completed-artifact cleanup explicit.

### Watch UI And App Wiring

- Modify `apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.swift`: install `WKApplicationDelegate`, register the App Intent dependency, and inject shared services.
- Modify `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`: remove local auto-start monitoring, start real sessions through the coordinator, and navigate from coordinator phase.
- Modify `apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift`: make the live instrument reusable and add a bounded real/demo control row.
- Create `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`: observe app-scoped recording/summary/no-sample state without canceling on disappearance.
- Create `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`: own demo/debug recorder, Crown control, surface gate, summary, and cleanup.
- Modify `apps/mobile/ios/DivenaryWatchApp/Views/DepthGaugeRail.swift`: publish the stable `62pt` layout width used to align the control row.
- Modify `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`: add Crown-ending and no-sample copy in every existing locale.
- Modify `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`: return save success without breaking existing ignored-return call sites.

### Signing, Tests, And Documentation

- Create `apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.entitlements`.
- Modify `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj` for entitlement settings and new source/test membership.
- Create `apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift`.
- Create `apps/mobile/ios/DivenaryWatchAppTests/DiveRuntimeSessionControllerTests.swift`.
- Create `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`.
- Create `apps/mobile/ios/DivenaryWatchAppTests/DiveActionButtonIntentTests.swift`.
- Create `docs/2026-07-18-watch-underwater-runtime-device-checklist.md`.
- Create `.wiki/raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md` and update the Watch architecture, QA, open-question, index, and log pages.

---

### Task 1: Add shallow-depth signing metadata

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.entitlements`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`
- Verify: `apps/mobile/ios/DivenaryWatchApp/Info.plist`

**Contract:** Watch Debug and Release point to the new entitlement file; it contains `com.apple.developer.submerged-shallow-depth-and-pressure = true`; `underwater-depth` remains in `WKBackgroundModes`; no undocumented launch key is introduced.

- [ ] **Step 1: Prove the project is missing the Watch capability**

Run:

```bash
rg -n "CODE_SIGN_ENTITLEMENTS|submerged-shallow-depth-and-pressure" apps/mobile/ios/Divenary.xcodeproj/project.pbxproj apps/mobile/ios/DivenaryWatchApp
```

Expected: only iPhone entitlement settings appear; the Watch target has no shallow-depth entitlement.

- [ ] **Step 2: Add the Watch entitlement file**

Create a valid XML property list whose payload is exactly:

```xml
<dict>
    <key>com.apple.developer.submerged-shallow-depth-and-pressure</key>
    <true/>
</dict>
```

- [ ] **Step 3: Wire both Watch build configurations**

Set this only in the `DivenaryWatchApp` Debug and Release build settings:

```text
CODE_SIGN_ENTITLEMENTS = DivenaryWatchApp/DivenaryWatchApp.entitlements;
```

Do not change the iPhone target's `Divenary/Divenary.entitlements` setting.

- [ ] **Step 4: Validate repository metadata**

Run:

```bash
plutil -lint apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.entitlements
plutil -p apps/mobile/ios/DivenaryWatchApp/Info.plist
rg -n "WKSupportsAutomaticDepthLaunch" apps/mobile/ios/DivenaryWatchApp apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
yarn watch:build
```

Expected: the plist is valid, `underwater-depth` is present, the undocumented-key search returns no matches, and the simulator build passes. The `rg` no-match exit is expected.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.entitlements apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "build: enable shallow watch submersion capability"
```

### Task 2: Centralize Core Motion submersion ownership

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sensors/RealDepthSensorProvider.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**

```swift
enum WaterSubmersionState: Equatable {
    case unknown, notSubmerged, submerged
}

enum WaterDepthState: Equatable {
    case unknown, notSubmerged, submergedShallow, submergedDeep
    case approachingMaxDepth, pastMaxDepth, sensorDepthError
}

@MainActor
protocol WaterSubmersionStateReading: AnyObject {
    var latestState: WaterSubmersionState { get }
}

@MainActor
final class WaterSubmersionCoordinator: NSObject, ObservableObject,
    WaterSubmersionStateReading, CMWaterSubmersionManagerDelegate {
    var onSample: ((DepthSample) -> Void)?
    var onEvent: ((WaterSubmersionState, Date) -> Void)?
    var onError: ((Error) -> Void)?
    @Published private(set) var latestState: WaterSubmersionState = .unknown
    @Published private(set) var latestDepthState: WaterDepthState = .unknown
    @Published private(set) var maximumDepthMeters: Double?
    func startMonitoring()
}
```

The initializer accepts an optional manager factory so unsupported simulators do not unconditionally construct a production manager. Pure helpers normalize Apple enum values and finite meter/kPa/Celsius inputs before creating `DepthSample`.

- [ ] **Step 1: Add failing conversion and lifecycle tests**

Cover every event/depth-state mapping, valid measurement conversion, missing depth/pressure, non-finite values, latest valid temperature reuse, error forwarding, manager unavailability, idempotent repeated `startMonitoring()`, and authorized maximum-depth conversion.

```swift
func testValidMeasurementProducesSampleUsingLatestTemperature() throws {
    let result = WaterSubmersionCoordinator.makeSample(
        timestamp: date(4),
        depthMeters: 0.15,
        pressureKPa: 102.8,
        temperatureCelsius: 18.4,
        depthState: .submergedShallow
    )
    let sample = try XCTUnwrap(result)
    XCTAssertEqual(sample.depthMeters, 0.15, accuracy: 0.001)
    XCTAssertEqual(try XCTUnwrap(sample.waterTemperatureCelsius), 18.4, accuracy: 0.001)
}
```

- [ ] **Step 2: Prove the focused tests fail**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/WaterSubmersionCoordinatorTests test
```

Expected: FAIL because `WaterSubmersionCoordinator` does not exist.

- [ ] **Step 3: Implement the sole manager owner**

Set the Core Motion delegate only from `startMonitoring()`, keep it set for process lifetime, and update published state on the main actor. Refresh `maximumDepthMeters` immediately after delegate assignment and on every event, measurement, temperature, or error callback so a post-TCC authorization change is observed. Convert the authorization limit with:

```swift
maximumDepthMeters = manager.maximumDepth?.converted(to: .meters).value
```

Do not call `manager.delegate = nil` when a recording screen disappears.

- [ ] **Step 4: Convert `RealDepthSensorProvider` to an adapter**

```swift
@MainActor
final class RealDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?
    private let coordinator: WaterSubmersionCoordinator

    func start() {
        coordinator.onSample = { [weak self] sample in self?.onSample?(sample) }
        coordinator.startMonitoring()
    }

    func stop() {
        coordinator.onSample = nil
    }
}
```

The provider no longer conforms to `CMWaterSubmersionManagerDelegate` and owns no manager.

- [ ] **Step 5: Run focused and full Watch tests**

Run the focused command from Step 2, then:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData test
```

Expected: focused tests pass and the suite has no regressions from the 80-test baseline.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Sensors apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "refactor: centralize watch submersion monitoring"
```

### Task 3: Own and adopt underwater runtime sessions

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveRuntimeSessionController.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/DiveRuntimeSessionControllerTests.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**

```swift
enum DiveRuntimeEvent {
    case adoptedSystemSession
    case didStart
    case willExpire
    case didInvalidate(
        reason: WKExtendedRuntimeSessionInvalidationReason,
        errorDescription: String?
    )
}

@MainActor
protocol DiveRuntimeSessionAdapterDelegate: AnyObject {
    func runtimeAdapterDidStart(_ adapter: DiveRuntimeSessionAdapter)
    func runtimeAdapterWillExpire(_ adapter: DiveRuntimeSessionAdapter)
    func runtimeAdapter(
        _ adapter: DiveRuntimeSessionAdapter,
        didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    )
}

@MainActor
protocol DiveRuntimeSessionAdapter: AnyObject {
    var delegate: DiveRuntimeSessionAdapterDelegate? { get set }
    func start()
    func invalidate()
}

@MainActor
protocol DiveRuntimeSessionAdapterFactory: AnyObject {
    func makeManualAdapter() -> DiveRuntimeSessionAdapter
    func makeAdapter(for session: WKExtendedRuntimeSession) -> DiveRuntimeSessionAdapter
}

@MainActor
protocol DiveRuntimeSessionControlling: AnyObject {
    var onEvent: ((DiveRuntimeEvent) -> Void)? { get set }
    func startManualSession()
    func adoptSystemSession(_ session: WKExtendedRuntimeSession)
    func invalidate()
}
```

`WatchExtendedRuntimeSessionAdapter` wraps a concrete session and immediately sets itself as the concrete `WKExtendedRuntimeSessionDelegate`. A factory creates a wrapper for manual starts or wraps the exact instance supplied by watchOS.

- [ ] **Step 1: Add failing adapter/controller tests**

Use fake adapters and a recording factory to prove manual delegate-before-start ordering, adopted delegate attachment without `start()`, synchronous `.adoptedSystemSession`, ordered lifecycle forwarding, one forwarded invalidation, one explicit invalidation call, and clean replacement after invalidation.

```swift
func testManualStartAssignsDelegateBeforeAdapterStart() {
    controller.startManualSession()
    XCTAssertEqual(adapter.calls, [.setDelegate, .start])
}
```

- [ ] **Step 2: Prove the focused tests fail**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/DiveRuntimeSessionControllerTests test
```

Expected: FAIL because the controller and adapter contracts do not exist.

- [ ] **Step 3: Implement production delegate translation**

`WatchExtendedRuntimeSessionAdapter` is the only type conforming to Apple's delegate. Translate `extendedRuntimeSessionDidStart`, `extendedRuntimeSessionWillExpire`, and `didInvalidateWith` without adding timer, depth, or recording logic.

- [ ] **Step 4: Implement manual and adopted ownership**

For manual start, create, attach, retain, then start. For adoption, wrap, attach, retain, then synchronously emit `.adoptedSystemSession`. Clear the active adapter only after forwarding invalidation.

- [ ] **Step 5: Pass focused tests and compile**

Run the focused command from Step 2, then `yarn watch:build`.

Expected: tests and Watch build pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Runtime/DiveRuntimeSessionController.swift apps/mobile/ios/DivenaryWatchAppTests/DiveRuntimeSessionControllerTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: manage watch underwater runtime sessions"
```

### Task 4: Add the idempotent real-recording state machine

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**

```swift
enum RealDiveStartSource: Equatable {
    case manual, systemAutoLaunch, actionButton
}

enum RealDivePhase {
    case idle
    case recording(source: RealDiveStartSource)
    case summary(DiveSessionRecord)
    case noSamples
}

@MainActor
protocol DiveSessionRecording: AnyObject {
    var elapsedTime: TimeInterval { get }
    var hasCapturedDepthSample: Bool { get }
    func startSession(plan: PreDivePlan)
    func stopSession() -> DiveSessionRecord?
    func cancelSession()
}

@MainActor
protocol DiveActionButtonDonating: AnyObject {
    func donateEndAction()
}

@MainActor
final class RealDiveSessionCoordinator: ObservableObject {
    @Published private(set) var phase: RealDivePhase = .idle
    func startManual(plan: PreDivePlan)
    func startFromActionButton()
    func requestActionButtonEnd() -> Bool
    func markSummarySaved()
    func discardSummary()
    func dismissNoSamples()
}
```

Inject `preferredMode: () -> DiveMode`, `DiveRuntimeSessionControlling`, `DiveSessionRecording`, `WaterSubmersionStateReading`, and `DiveActionButtonDonating`. `DiveSessionRecorder` conforms directly and defines sample presence from accepted raw samples, not finalized one-hertz buckets.

- [ ] **Step 1: Add failing coordinator tests**

Cover all of these behaviors:

- manual start preserves the explicit plan and starts the recorder before manual runtime,
- Action Button start and `.adoptedSystemSession` use `PreDivePlan(diveMode: preferredMode())`,
- Action Button start requests a new manual underwater runtime, while adopted-system start never calls runtime `start()`,
- manual and system starts donate the end action; Action Button start leaves that result to its intent so donation is not duplicated,
- donation failure never cancels recording,
- duplicate starts while non-idle do nothing,
- `notSubmerged` and resubmersion do not stop or replace the recording,
- Action Button end rejects submerged, unknown, and elapsed `< 180s` states,
- surfaced `>= 180s` end invalidates runtime but never calls `stopSession()` directly,
- runtime invalidation with samples creates one summary after duplicate callbacks,
- manual/Action Button no-sample invalidation cancels and shows `.noSamples`,
- automatic no-sample invalidation cancels and returns to `.idle`,
- summary discard clears the active artifact,
- a failed store save leaves summary active; successful save permits completion.

- [ ] **Step 2: Prove the focused tests fail**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/RealDiveSessionCoordinatorTests test
```

Expected: FAIL because the real-session coordinator does not exist.

- [ ] **Step 3: Add recorder sample presence**

Expose:

```swift
var hasCapturedDepthSample: Bool { lastRawSample != nil }
```

Keep `stopSession()` responsible for flushing the one-hertz sampler and constructing a record. Keep `cancelSession()` responsible for clearing the active journal. The coordinator calls `cancelSession()` instead of constructing an empty record when no valid sample was captured.

- [ ] **Step 4: Return persistence success from the store**

Change the existing method to:

```swift
@discardableResult
func save(_ session: DiveSessionRecord) -> Bool
```

Return `true` only after artifact finalization, manifest update, active-recording cleanup, and in-memory insertion complete; return `false` from the existing catch path. Existing debug and test call sites may ignore the result.

- [ ] **Step 5: Implement one finalization path**

Bind `runtime.onEvent` once in coordinator initialization. Manual and Action Button starts call `recorder.startSession` before `runtime.startManualSession`; system adoption starts only the recorder from `.adoptedSystemSession` and does not wait for `.didStart`. Only `.didInvalidate` calls the private idempotent finalizer.

```swift
private func finalizeAfterRuntimeInvalidation() {
    guard case let .recording(source) = phase else { return }
    guard recorder.hasCapturedDepthSample else {
        recorder.cancelSession()
        phase = source == .systemAutoLaunch ? .idle : .noSamples
        return
    }
    guard let record = recorder.stopSession() else {
        recorder.cancelSession()
        phase = source == .systemAutoLaunch ? .idle : .noSamples
        return
    }
    phase = .summary(record)
}
```

`requestActionButtonEnd()` requires `water.latestState == .notSubmerged` and `recorder.elapsedTime >= 180`, then calls `runtime.invalidate()`. It does not finalize synchronously. `markSummarySaved()` and `discardSummary()` both reset recorder state; discard also relies on `cancelSession()` to remove the active artifact.

- [ ] **Step 6: Pass focused and store regression tests**

Run the focused command from Step 2, then:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/DiveSessionRecordMigrationTests test
```

Expected: both suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: coordinate real watch dive lifecycle"
```

### Task 5: Route Apple Watch Ultra Action Button intents

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveActionButtonIntents.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/DiveActionButtonIntentTests.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**

```swift
@MainActor
protocol RealDiveActionControlling: AnyObject, Sendable {
    func startFromActionButton()
    func requestActionButtonEnd() -> Bool
}

@MainActor
final class DiveActionButtonBridge: Sendable {
    func startDive()
    func requestEndDive() -> Bool
}

struct DivenaryStartDiveIntent: StartDiveIntent {
    static let title: LocalizedStringResource = "Start Divenary Dive"
    @Dependency private var bridge: DiveActionButtonBridge
    func perform() async throws -> some IntentResult
}

struct DivenaryEndDiveIntent: AppIntent {
    static let title: LocalizedStringResource = "End Divenary Dive"
    @Dependency private var bridge: DiveActionButtonBridge
    func perform() async throws -> some IntentResult
}
```

- [ ] **Step 1: Add failing bridge and intent-policy tests**

Test the bridge with a fake `RealDiveActionControlling`. Prove start invokes the Action Button source once, accepted end reaches coordinator invalidation once, rejected end keeps recording, and the start result supplies `DivenaryEndDiveIntent` as the next action.

- [ ] **Step 2: Prove the focused tests fail**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/DiveActionButtonIntentTests test
```

Expected: FAIL because the bridge and intents do not exist.

- [ ] **Step 3: Implement start and end intents**

The start intent performs on the shared bridge and returns the next action:

```swift
func perform() async throws -> some IntentResult {
    await bridge.startDive()
    return .result(actionButtonIntent: DivenaryEndDiveIntent())
}
```

The end intent calls `requestEndDive()`. A rejected request returns the end intent again so an underwater or too-early press does not change phase. An accepted request returns a plain result because the next recording will donate a new end action. It only asks the runtime to invalidate; finalization still waits for runtime invalidation.

```swift
func perform() async throws -> some IntentResult {
    if await bridge.requestEndDive() {
        return .result()
    }
    return .result(actionButtonIntent: DivenaryEndDiveIntent())
}
```

- [ ] **Step 4: Implement donation for non-Action-Button starts**

The production `DiveActionButtonDonating` implementation is used by manual and system starts only. Define an `OSLog.Logger` in that implementation and select the throwing asynchronous donation overload so failure can be observed:

```swift
func donateEndAction() {
    Task {
        do {
            _ = try await DivenaryStartDiveIntent().donate(
                result: .result(actionButtonIntent: DivenaryEndDiveIntent())
            )
        } catch {
            logger.error("Action Button donation failed: \(error.localizedDescription)")
        }
    }
}
```

Donation failure is logged as non-fatal and never stops a recording.

- [ ] **Step 5: Pass focused tests and compile**

Run the focused command from Step 2, then `yarn watch:build`.

Expected: tests and Watch build pass with the watchOS 10 deployment target.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Runtime/DiveActionButtonIntents.swift apps/mobile/ios/DivenaryWatchAppTests/DiveActionButtonIntentTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: add watch dive action button intents"
```

### Task 6: Wire app-scoped services and split real/simulated UI

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`
- Create: `apps/mobile/ios/DivenaryWatchApp/Runtime/DivenaryWatchApplicationDelegate.swift`
- Create: `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`
- Create: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/DepthGaugeRail.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Composition:**

```swift
@MainActor
final class DiveAppServices {
    static let shared = DiveAppServices()
    let store: DiveSessionStore
    let water: WaterSubmersionCoordinator
    let runtime: DiveRuntimeSessionController
    let realSensorProvider: RealDepthSensorProvider
    let realRecorder: DiveSessionRecorder
    let realCoordinator: RealDiveSessionCoordinator
    let actionButtonBridge: DiveActionButtonBridge
}

@MainActor
final class DivenaryWatchApplicationDelegate: NSObject, WKApplicationDelegate {
    func handle(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        DiveAppServices.shared.runtime.adoptSystemSession(extendedRuntimeSession)
    }
}
```

- [ ] **Step 1: Add policy regressions before refactoring views**

Extend an existing Watch mode suite or add a focused test file proving:

- `.real` does not construct `DemoDepthSensorProvider`, use Crown depth control, or expose a touch end policy,
- `.demo` and `.debugTest` construct demo providers, use Crown control, and retain `SurfaceEndDiveGate`,
- the gate appears after `<= 1.0m` for 3 seconds and hides at `>= 1.2m`,
- real navigation derives from coordinator phase rather than a local depth trigger.

- [ ] **Step 2: Create and register the process object graph**

Initialize services in dependency order, bind coordinator callbacks before starting water monitoring, then call `water.startMonitoring()`. In `DivenaryWatchApp`, install:

```swift
@WKApplicationDelegateAdaptor(DivenaryWatchApplicationDelegate.self)
private var applicationDelegate
```

Register the actor-isolated, `Sendable` bridge during app initialization:

```swift
AppDependencyManager.shared.add(
    dependency: DiveAppServices.shared.actionButtonBridge
)
```

Initialize `@StateObject` wrappers from the same service graph and pass the shared store/coordinator to `HomeView`. No SwiftUI view creates a second real provider, manager, runtime, or real recorder.

- [ ] **Step 3: Remove local depth auto-start and route real starts**

Delete `DiveAutoStartMonitor`, `AutomaticDiveStartRequest`, `autoStartMonitor`, and the `3m` trigger from `HomeView`. Real start cards become `Button` actions:

```swift
store.updatePreferredDiveMode(mode)
realCoordinator.startManual(plan: explicitStartPlan(for: mode))
```

Explicit planned-dive metadata remains available only for a Home start. System and Action Button starts use `PreDivePlan(diveMode: store.preferredDiveMode)`.

Keep `DepthAutoLaunchAuthorization`, its Home status text, and refresh behavior. `.active` continues to mean Divenary is the selected default responder; it is not used as proof of sensor entitlement.

Present one `RealRecordingFlowView` while coordinator phase is recording, summary, or no-samples. An adopted runtime must trigger the same navigation even when no Home button was tapped.

- [ ] **Step 4: Split real and simulated flow ownership**

Refactor the existing live instrument into `RecordingInstrumentView`, still located in `RecordingView.swift`, with an observed recorder plus a control policy. `RealRecordingFlowView` never starts or cancels recording from `onAppear`/`onDisappear`. It saves with:

```swift
if store.save(session) {
    realCoordinator.markSummarySaved()
}
```

Discard calls `realCoordinator.discardSummary()`. `.noSamples` shows `No depth samples captured` and one `Done` button after Water Lock is already off.

Hide navigation back for the full real flow so a recording, unsaved summary, or pending no-sample acknowledgement cannot be abandoned through a pop gesture. Coordinator save, discard, and `Done` transitions are the only ways back to idle.

`SimulatedRecordingFlowView` retains the current view-scoped lifecycle: create its demo recorder, start on appear, adjust depth with Digital Crown, stop from the surface-gated button, and show Summary. Dismiss a save only when `store.save` returns `true`; discard and unfinished disappearance call recorder cleanup so no active demo artifact remains.

- [ ] **Step 5: Build the bounded control row**

Expose this constant from `DepthGaugeRail` and use it for the rail frame:

```swift
static let layoutWidth: CGFloat = 62
```

Render a stable control row between the live instrument and disclaimer. Reserve `DepthGaugeRail.layoutWidth + 9` on its leading edge to align with the right-value column.

The Korean real-session copy must be exactly:

```text
즉시 다이빙을 종료하려면 물 밖에서 Digital Crown을 길게 누르세요.
```

Use 10pt muted text, at most two lines, `minimumScaleFactor(0.75)`, and a bounded 30-36pt row height. Demo/debug puts the compact `End Dive` button in that same slot. Remove the bottom-trailing overlay so controls cannot cover metrics or the disclaimer.

- [ ] **Step 6: Use the signed sensor limit in existing warning UI**

Pass `water.maximumDepthMeters` into `RecordingInstrumentView`. Compute the live warning threshold as:

```swift
let sensorDisplayLimitMeters = min(
    maximumDepthMeters ?? DiveDepthSupport.supportedWatchDepthLimitMeters,
    DiveDepthSupport.supportedWatchDepthLimitMeters
)
```

Change `UnsupportedDepthWarning` to accept that threshold and show `Outside sensor-authorized depth` when current depth exceeds it. Keep `DiveDepthSupport.supportedWatchDepthLimitMeters = 40` as the product/storage boundary and leave `UnsupportedDepthRecord` unchanged. Never imply that the shallow-signed build is sensor-authorized to 40m.

- [ ] **Step 7: Update the String Catalog**

Add values in every locale already present in `Localizable.xcstrings` for the Crown-ending instruction, `No depth samples captured`, `Outside sensor-authorized depth`, and Action Button intent titles. Reuse `Done` if it is already cataloged. Preserve the existing safety-language guard.

- [ ] **Step 8: Run all Watch tests and compile**

Run:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData test
yarn watch:build
```

Expected: all Watch tests and the Watch build pass. Confirm from project membership and build logs that each new Swift file belongs to the intended target exactly once.

- [ ] **Step 9: Inspect 42mm, 46mm, and 49mm layouts**

Inspect real-flow dependency fixtures and demo/debug flows on installed `Apple Watch Series 11 (42mm)`, `Apple Watch Series 11 (46mm)`, and `Apple Watch Ultra 3 (49mm)` simulators. Confirm no overlap or clipping among the depth rail, live values, reminder state, sensor-limit warning, control row, and disclaimer.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp apps/mobile/ios/DivenaryWatchAppTests apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: wire watch underwater recording lifecycle"
```

### Task 7: Record signed-device verification and durable knowledge

**Files:**
- Create: `docs/2026-07-18-watch-underwater-runtime-device-checklist.md`
- Create: `.wiki/raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md`
- Modify: `.wiki/wiki/architecture/watch-app.md`
- Modify: `.wiki/wiki/project/diving-app-qa-test-plan.md`
- Modify: `.wiki/wiki/questions/open-questions.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

- [ ] **Step 1: Write the signed-bundle checklist**

Include the exact device-build command:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchApp -configuration Debug -destination 'generic/platform=watchOS' -derivedDataPath /private/tmp/DivenaryWatchDeviceDerivedData build
```

Inspect the resulting app:

```bash
plutil -p /private/tmp/DivenaryWatchDeviceDerivedData/Build/Products/Debug-watchos/DivenaryWatchApp.app/Info.plist
codesign -d --entitlements :- /private/tmp/DivenaryWatchDeviceDerivedData/Build/Products/Debug-watchos/DivenaryWatchApp.app
security cms -D -i /private/tmp/DivenaryWatchDeviceDerivedData/Build/Products/Debug-watchos/DivenaryWatchApp.app/embedded.mobileprovision
```

Require evidence for `underwater-depth`, the shallow entitlement in both code signature and provisioning profile, installed app version, hardware model, watchOS version, and `requestAutoLaunchAuthorizationStatus`.

- [ ] **Step 2: Define the physical test matrix**

Record separate pass/fail/evidence rows for:

- reinstall and presence in Settings > General > Auto-Launch > When Submerged,
- 15cm manually started real session showing approximately `0.1m` and Water Lock,
- explicit note that 15cm is not an automatic-launch pass,
- Xcode Easy Submersion or safely controlled `>1m` system launch and `handle(_:)` adoption,
- preferred-mode automatic start,
- surface then Digital Crown hold producing exactly one summary,
- Divenary configured as the Action Button Dive app, first-press start, rejected underwater/early end, and surfaced `>=3m` end,
- continuous out-of-water `>10m` system invalidation,
- resubmerge before 10 minutes preserving the same local session ID,
- manual/Action Button no-sample result versus silent system no-sample cancellation,
- demo/debug Crown depth and touch ending without Water Lock,
- 42mm, 46mm, and 49mm clipping/overlap inspection.

- [ ] **Step 3: Ingest and compile wiki knowledge**

Follow `karpathy-llm-wiki` and `wiki-writing`. The immutable raw source records verified API decisions and links to the design, plan, and device checklist. Update compiled pages in Korean to remove stale `3m` app-trigger claims, describe app-scoped runtime/sensor ownership, and keep full-depth entitlement and physical behavior as open external gates.

- [ ] **Step 4: Run final automated gates**

Run:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData test
yarn watch:build
yarn codex:check
```

Expected: all commands pass. Record the exact XCTest count instead of assuming it from the baseline.

- [ ] **Step 5: Run the signed build when credentials are available**

Run the generic watchOS build and three inspection commands from Step 1. If provisioning is unavailable, record the exact signing failure as an unresolved external gate; do not mark device/signing verification complete from a simulator build.

- [ ] **Step 6: Commit**

```bash
git add docs/2026-07-18-watch-underwater-runtime-device-checklist.md .wiki
git commit -m "docs: add watch underwater runtime verification"
```

## Completion Gate

- Real manual, system-adopted, and Action Button starts all use the same app-scoped coordinator and recorder.
- Real recording has no touch end action; demo/debug retains the surface-gated action.
- Digital Crown, accepted Action Button, and watchOS out-of-water invalidation converge on one idempotent finalizer.
- No app-side 10-minute timer, local depth auto-start monitor, second Core Motion manager, or undocumented plist key remains.
- The shallow entitlement is present in repository metadata; signed bundle/profile evidence is either captured or explicitly left open.
- Automatic no-sample attempts save nothing; user-started no-sample attempts show one compact result.
- Watch tests, `yarn watch:build`, and `yarn codex:check` pass with exact results recorded.
- The device checklist distinguishes 15cm manual sampling from `>1m` or Easy Submersion automatic launch.
