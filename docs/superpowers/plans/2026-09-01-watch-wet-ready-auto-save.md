# Watch Wet Ready and Automatic Session Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Crown-controlled Wet Ready state before watchOS automatic recording, lock the chosen mode for the active session, and persist completed real sessions without wet post-dive input.

**Architecture:** Extend `RealDiveSessionCoordinator` as the single authority for water readiness, runtime adoption, immutable active plans, and completion persistence. Keep `WaterSubmersionCoordinator` as the sole Core Motion owner, route published state into the coordinator from SwiftUI, and split read-only session metrics from real versus simulated completion actions.

**Tech Stack:** Swift, SwiftUI, Combine, Core Motion, WatchKit extended runtime, XCTest, Xcode CLI, Yarn 1, Karpathy LLM Wiki

## Global Constraints

- Divenary remains a non-certified logging, post-dive review, and planning-reminder companion.
- Do not add decompression, tissue-loading, ceiling, NDL, gas-switching, emergency, medical, or safe-to-descend/ascend calculations or claims.
- Wet Ready exposes exactly two modes: `DiveMode.freedive` and `DiveMode.scuba`.
- Water detection enters Wet Ready; only watchOS underwater runtime adoption, dry manual start, or the existing Action Button start may begin real recording.
- Do not add an app-owned 1-meter, 3-meter, or 30-second recording-start threshold.
- A stable `notSubmerged` state dismisses Wet Ready after exactly 2 seconds; this delay never starts or ends a session.
- Mode and `PreDivePlan` become immutable when recording starts; active-session mode switching is prohibited.
- Real-session completion saves locally before showing `Saved`; no subjective post-dive input, Save, Discard, or Delete is shown in the wet real flow.
- Missing rating, exertion, visibility, and notes remain `nil`; missing water condition remains `.unknown`.
- Demo/debug keeps explicit Save and Discard so simulated data does not accumulate automatically, but removes subjective post-dive input.
- Keep existing runtime-invalidation and Action Button end rules, including the surfaced `>=180s` guard; do not add a Crown-press app action.
- Preserve the existing watch session schema, generated contract output, WatchConnectivity acknowledgement meaning, account sync meaning, and guest-claim meaning.
- Do not add dependencies or modify Yarn lockfiles. Use the repository's Yarn 1 commands.
- Do not edit generated contract output.
- Physical Water Lock, Crown focus, automatic launch, and real sensor behavior remain unverified until the supported-device gate is executed.

---

## File Structure

- `apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift`: publishes the latest valid shallow depth for Wet Ready without creating another Core Motion owner.
- `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`: owns Wet Ready, two-second dry debounce, armed-mode persistence, immutable active plans, completion save, and recoverable save failure.
- `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`: wires the existing process-scoped store into the coordinator as preference and persistence dependencies.
- `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`: conforms to the coordinator's small local-persistence protocol without changing save semantics.
- `apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift`: renders the focused two-mode Crown selector.
- `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`: forwards current and changed water state to the coordinator.
- `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`: renders Wet Ready, the locked active plan, save progress, saved summary, and retryable save error.
- `apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift`: contains shared read-only summary metrics plus separate saved-real and captured-simulated action wrappers.
- `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`: uses the captured-simulated summary wrapper with explicit Save/Discard.
- `apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift`: removes copy that implies the app receives a Crown press.
- `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`: adds complete English and Korean Wet Ready, save, recovery, and edit-on-iPhone copy.
- `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`: includes `WetReadyView.swift` in the Views group and Watch target Sources phase.
- `apps/mobile/scripts/check-watch-ui-language.mjs`: covers the new watch source and prevents regression to wet post-dive input or Crown-press claims.
- `apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift`: tests latest-depth publication and clearing.
- `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`: tests Wet Ready ordering, mode lock, automatic save, retry, cleanup order, and no-sample behavior.
- `docs/2026-07-18-watch-underwater-runtime-device-checklist.md`: adds Wet Ready, Crown, automatic-save, and recovery physical evidence rows.
- `.wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md`: preserves implemented behavior and pending device gates as immutable source material.
- `.wiki/wiki/architecture/watch-app.md`: compiles the new runtime and persistence ownership.
- `.wiki/wiki/project/diving-app-qa-test-plan.md`: compiles the updated automatic and physical test gates.
- `.wiki/wiki/index.md`: refreshes affected article dates.
- `.wiki/wiki/log.md`: records the ingest.

### Task 1: Publish The Latest Valid Wet-Ready Depth

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift`

**Interfaces:**
- Consumes: `WaterSubmersionCoordinator.makeSample(...)`, `WaterDepthState`, and existing `receiveEvent`/`receiveMeasurement` test hooks.
- Produces: `@Published private(set) var latestDepthMeters: Double?`, containing the latest valid nonnegative depth and clearing on `notSubmerged` or `sensorDepthError`.

- [ ] **Step 1: Write failing latest-depth publication tests**

Add these tests to `WaterSubmersionCoordinatorTests` beside the current receive-measurement tests:

```swift
func testValidMeasurementPublishesLatestDepthMeters() {
    let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })

    coordinator.receiveMeasurement(
        timestamp: Date(timeIntervalSince1970: 1),
        depthMeters: 0.12,
        pressureKPa: 102.4,
        depthState: .submergedShallow
    )

    XCTAssertEqual(coordinator.latestDepthMeters, 0.12, accuracy: 0.001)
}

func testNotSubmergedEventClearsLatestDepthMeters() {
    let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
    coordinator.receiveMeasurement(
        timestamp: Date(timeIntervalSince1970: 1),
        depthMeters: 0.12,
        pressureKPa: 102.4,
        depthState: .submergedShallow
    )

    coordinator.receiveEvent(state: .notSubmerged, at: Date(timeIntervalSince1970: 2))

    XCTAssertNil(coordinator.latestDepthMeters)
}

func testSensorDepthErrorClearsLatestDepthMeters() {
    let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
    coordinator.receiveMeasurement(
        timestamp: Date(timeIntervalSince1970: 1),
        depthMeters: 0.12,
        pressureKPa: 102.4,
        depthState: .submergedShallow
    )

    coordinator.receiveMeasurement(
        timestamp: Date(timeIntervalSince1970: 2),
        depthMeters: nil,
        pressureKPa: nil,
        depthState: .sensorDepthError
    )

    XCTAssertNil(coordinator.latestDepthMeters)
}
```

- [ ] **Step 2: Run the focused sensor tests and verify RED**

```bash
xcodebuild test \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  -only-testing:DivenaryWatchAppTests/WaterSubmersionCoordinatorTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: compilation fails because `latestDepthMeters` does not exist.

- [ ] **Step 3: Implement latest-depth publication and clearing**

Add the published property with the existing published water state:

```swift
@Published private(set) var latestState: WaterSubmersionState = .unknown
@Published private(set) var latestDepthState: WaterDepthState = .unknown
@Published private(set) var latestDepthMeters: Double?
@Published private(set) var maximumDepthMeters: Double?
```

Replace `receiveEvent` and the sample guard inside `receiveMeasurement` with:

```swift
func receiveEvent(state: WaterSubmersionState, at timestamp: Date) {
    latestState = state
    if state == .notSubmerged {
        latestDepthMeters = nil
    }
    onEvent?(state, timestamp)
}

func receiveMeasurement(
    timestamp: Date,
    depthMeters: Double?,
    pressureKPa: Double?,
    depthState: WaterDepthState
) {
    latestDepthState = depthState
    guard let sample = Self.makeSample(
        timestamp: timestamp,
        depthMeters: depthMeters,
        pressureKPa: pressureKPa,
        temperatureCelsius: latestTemperatureCelsius,
        depthState: depthState
    ) else {
        if depthState == .notSubmerged || depthState == .sensorDepthError {
            latestDepthMeters = nil
        }
        return
    }

    latestDepthMeters = sample.depthMeters
    onSample?(sample)
}
```

Do not create a second `CMWaterSubmersionManager`, buffer a session, or start the recorder in this task.

- [ ] **Step 4: Run the focused sensor tests and verify GREEN**

Run the exact `xcodebuild test` command from Step 2.

Expected: all `WaterSubmersionCoordinatorTests` pass.

- [ ] **Step 5: Review and commit the sensor state**

```bash
git diff --check -- apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift
git diff -- apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift
git add apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift apps/mobile/ios/DivenaryWatchAppTests/WaterSubmersionCoordinatorTests.swift
git commit -m "feat(watch): publish wet-ready depth"
```

Expected: only the sensor coordinator and its tests are committed. Existing `.turbo` cache changes remain untouched.

### Task 2: Add Wet Ready, Crown Selection, And Active-Plan Locking

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`
- Create: `apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs`

**Interfaces:**
- Consumes: Task 1's `WaterSubmersionCoordinator.latestDepthMeters`, existing runtime events, `DiveSessionStore.preferredDiveMode`, and `DiveSessionStore.updatePreferredDiveMode(_:)`.
- Produces: `RealDivePhase.wetReady(mode:)`, `RealDivePhase.recording(source:plan:)`, `RealDiveSessionCoordinator.receiveWaterState(_:)`, `selectWetReadyMode(_:)`, and `WetReadyView(mode:currentDepthMeters:onSelect:)`.

- [ ] **Step 1: Add failing Wet Ready and mode-lock tests**

Add these focused tests to `RealDiveSessionCoordinatorTests`:

```swift
func testSubmersionEntersWetReadyWithoutStartingRecorder() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let water = FakeWaterStateReader(latestState: .submerged)
    let preference = FakeDiveModePreference(mode: .freedive)
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        water: water,
        preference: preference
    )

    coordinator.receiveWaterState(.submerged)

    assertWetReady(coordinator, mode: .freedive)
    XCTAssertTrue(recorder.startedPlans.isEmpty)
    XCTAssertEqual(runtime.startManualCallCount, 0)
}

func testWetReadySelectionPersistsAndAdoptedRuntimeLocksSelectedPlan() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let water = FakeWaterStateReader(latestState: .submerged)
    let preference = FakeDiveModePreference(mode: .scuba)
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        water: water,
        preference: preference
    )
    coordinator.receiveWaterState(.submerged)

    coordinator.selectWetReadyMode(.freedive)
    runtime.emit(.adoptedSystemSession)

    XCTAssertEqual(preference.mode, .freedive)
    XCTAssertEqual(preference.updates, [.freedive])
    XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
    assertRecording(
        coordinator,
        source: .systemAutoLaunch,
        plan: PreDivePlan(diveMode: .freedive)
    )
}

func testRuntimeBeforeWaterEventUsesPreferredModeFallback() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let preference = FakeDiveModePreference(mode: .scuba)
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        preference: preference
    )

    runtime.emit(.adoptedSystemSession)

    XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .scuba)])
    assertRecording(
        coordinator,
        source: .systemAutoLaunch,
        plan: PreDivePlan(diveMode: .scuba)
    )
}

func testStableDryExitDismissesWetReadyWithoutCreatingSession() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let water = FakeWaterStateReader(latestState: .submerged)
    let scheduler = FakeWetReadyExitScheduler()
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        water: water,
        scheduler: scheduler
    )
    coordinator.receiveWaterState(.submerged)

    water.latestState = .notSubmerged
    coordinator.receiveWaterState(.notSubmerged)
    assertWetReady(coordinator, mode: .scuba)
    scheduler.fire()

    assertIdle(coordinator)
    XCTAssertTrue(recorder.startedPlans.isEmpty)
    XCTAssertEqual(recorder.cancelCallCount, 0)
}

func testResubmersionCancelsPendingWetReadyExit() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let water = FakeWaterStateReader(latestState: .submerged)
    let scheduler = FakeWetReadyExitScheduler()
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        water: water,
        scheduler: scheduler
    )
    coordinator.receiveWaterState(.submerged)
    water.latestState = .notSubmerged
    coordinator.receiveWaterState(.notSubmerged)

    water.latestState = .submerged
    coordinator.receiveWaterState(.submerged)
    scheduler.fire()

    assertWetReady(coordinator, mode: .scuba)
    XCTAssertEqual(scheduler.cancelCallCount, 1)
}

func testActionButtonFromWetReadyUsesArmedMode() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let water = FakeWaterStateReader(latestState: .submerged)
    let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
    coordinator.receiveWaterState(.submerged)
    coordinator.selectWetReadyMode(.freedive)

    XCTAssertTrue(coordinator.startFromActionButton())

    XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
    assertRecording(
        coordinator,
        source: .actionButton,
        plan: PreDivePlan(diveMode: .freedive)
    )
}

func testRecordingRejectsWetReadyModeChanges() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls)
    let preference = FakeDiveModePreference(mode: .scuba)
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        preference: preference
    )
    coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))

    coordinator.selectWetReadyMode(.freedive)

    XCTAssertTrue(preference.updates.isEmpty)
    assertRecording(
        coordinator,
        source: .manual,
        plan: PreDivePlan(diveMode: .scuba)
    )
}
```

Add these test helpers and update the existing `makeCoordinator`/`assertRecording` helpers to use them:

```swift
@MainActor
private final class FakeDiveModePreference {
    var mode: DiveMode
    private(set) var updates: [DiveMode] = []

    init(mode: DiveMode) {
        self.mode = mode
    }

    func update(_ mode: DiveMode) {
        self.mode = mode
        updates.append(mode)
    }
}

@MainActor
private final class FakeWetReadyExitScheduler: WetReadyExitScheduling {
    private var action: (@MainActor () -> Void)?
    private(set) var cancelCallCount = 0

    func schedule(_ action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    func cancel() {
        if action != nil {
            cancelCallCount += 1
        }
        action = nil
    }

    func fire() {
        let pendingAction = action
        action = nil
        pendingAction?()
    }
}

private func assertWetReady(
    _ coordinator: RealDiveSessionCoordinator,
    mode: DiveMode,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    guard case let .wetReady(actualMode) = coordinator.phase else {
        return XCTFail("Expected wet-ready phase, received \(coordinator.phase)", file: file, line: line)
    }
    XCTAssertEqual(actualMode, mode, file: file, line: line)
}
```

Change `makeCoordinator` to accept `preference` and `scheduler`, and change `assertRecording` to pattern-match both source and plan:

```swift
private func makeCoordinator(
    preferredMode: DiveMode = .scuba,
    runtime: FakeDiveRuntime,
    recorder: FakeDiveRecorder,
    water: FakeWaterStateReader? = nil,
    donor: FakeActionButtonDonor? = nil,
    preference: FakeDiveModePreference? = nil,
    scheduler: FakeWetReadyExitScheduler? = nil
) -> RealDiveSessionCoordinator {
    let preference = preference ?? FakeDiveModePreference(mode: preferredMode)
    return RealDiveSessionCoordinator(
        preferredMode: { preference.mode },
        updatePreferredMode: preference.update,
        runtime: runtime,
        recorder: recorder,
        water: water ?? FakeWaterStateReader(),
        actionButtonDonor: donor ?? FakeActionButtonDonor(calls: LifecycleCallLog()),
        wetReadyExitScheduler: scheduler ?? FakeWetReadyExitScheduler()
    )
}

private func assertRecording(
    _ coordinator: RealDiveSessionCoordinator,
    source: RealDiveStartSource,
    plan expectedPlan: PreDivePlan? = nil,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    guard case let .recording(actualSource, actualPlan) = coordinator.phase else {
        return XCTFail("Expected recording phase, received \(coordinator.phase)", file: file, line: line)
    }
    XCTAssertEqual(actualSource, source, file: file, line: line)
    if let expectedPlan {
        XCTAssertEqual(actualPlan, expectedPlan, file: file, line: line)
    }
}
```

Update direct `RealDiveSessionCoordinator(...)` initializers in the same test file with `updatePreferredMode: { _ in }` and a fake scheduler.

- [ ] **Step 2: Run coordinator tests and verify RED**

```bash
xcodebuild test \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  -only-testing:DivenaryWatchAppTests/RealDiveSessionCoordinatorTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: compilation fails because Wet Ready phases, methods, scheduler, and recording plan association do not exist.

- [ ] **Step 3: Add the two-second scheduler and coordinator phases**

Add the scheduler boundary above `RealDiveSessionCoordinator`:

```swift
@MainActor
protocol WetReadyExitScheduling: AnyObject {
    func schedule(_ action: @escaping @MainActor () -> Void)
    func cancel()
}

@MainActor
final class TaskWetReadyExitScheduler: WetReadyExitScheduling {
    private var task: Task<Void, Never>?

    func schedule(_ action: @escaping @MainActor () -> Void) {
        cancel()
        task = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            action()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }
}
```

Change the relevant phase cases to:

```swift
enum RealDivePhase {
    case idle
    case wetReady(mode: DiveMode)
    case recording(source: RealDiveStartSource, plan: PreDivePlan)
    case summary(DiveSessionRecord)
    case noSamples
    case awaitingRuntimeInvalidation(source: RealDiveStartSource)
    case persistenceError(source: RealDiveStartSource)

    var presentsRecordingFlow: Bool {
        switch self {
        case .idle:
            return false
        case .wetReady, .recording, .summary, .noSamples,
             .awaitingRuntimeInvalidation, .persistenceError:
            return true
        }
    }
}
```

Add `updatePreferredMode` and `wetReadyExitScheduler` dependencies to the initializer, then add these methods:

```swift
func receiveWaterState(_ state: WaterSubmersionState) {
    switch state {
    case .submerged:
        wetReadyExitScheduler.cancel()
        guard case .idle = phase else { return }
        phase = .wetReady(mode: preferredMode())
    case .notSubmerged:
        guard case .wetReady = phase else { return }
        wetReadyExitScheduler.schedule { [weak self] in
            guard let self,
                  self.water.latestState == .notSubmerged,
                  case .wetReady = self.phase
            else {
                return
            }
            self.phase = .idle
        }
    case .unknown:
        wetReadyExitScheduler.cancel()
    }
}

func selectWetReadyMode(_ mode: DiveMode) {
    guard case let .wetReady(currentMode) = phase,
          currentMode != mode
    else {
        return
    }
    updatePreferredMode(mode)
    phase = .wetReady(mode: mode)
}
```

Use `phase = .recording(source: source, plan: plan)` for every successful start. In `startFromActionButton`, choose `PreDivePlan(diveMode:)` from the armed Wet Ready mode when present, otherwise from `preferredMode()`. In `startAdoptedSystemSession`, accept only `idle` or `wetReady`, cancel the exit scheduler, choose the armed mode when present, and use preferred mode as the runtime-first fallback. All other phases reject the event.

Update all existing `case .recording` patterns in the coordinator to accept the associated plan without changing end guards or invalidation semantics.

- [ ] **Step 4: Create the Crown-driven Wet Ready view**

Create `apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift` with:

```swift
import SwiftUI

struct WetReadyView: View {
    let mode: DiveMode
    let currentDepthMeters: Double?
    let onSelect: (DiveMode) -> Void

    @State private var crownValue: Double
    @FocusState private var crownFocused: Bool

    init(
        mode: DiveMode,
        currentDepthMeters: Double?,
        onSelect: @escaping (DiveMode) -> Void
    ) {
        self.mode = mode
        self.currentDepthMeters = currentDepthMeters
        self.onSelect = onSelect
        _crownValue = State(initialValue: mode.crownValue)
    }

    var body: some View {
        VStack(spacing: 8) {
            StatusPill(title: String(localized: "Ready"), color: accent)

            Image(systemName: systemImage)
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(accent)

            Text(mode.label)
                .font(DiveWatchTheme.metricFont(size: 28, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if let currentDepthMeters {
                Text(DiveFormatters.depth(currentDepthMeters))
                    .font(DiveWatchTheme.metricFont(size: 20, weight: .medium))
                    .foregroundStyle(DiveWatchTheme.primary)
                    .monospacedDigit()
            }

            Text("Underwater recording starts automatically.")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .multilineTextAlignment(.center)
                .lineLimit(2)

            HStack(spacing: 8) {
                modeButton(.freedive)
                modeButton(.scuba)
            }

            Text("Rotate the Digital Crown to choose a mode.")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.76))
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .focusable(true)
        .focused($crownFocused)
        .digitalCrownRotation(
            $crownValue,
            from: 0,
            through: 1,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onAppear {
            crownFocused = true
        }
        .onChange(of: crownValue) { _, nextValue in
            let nextMode: DiveMode = nextValue < 0.5 ? .freedive : .scuba
            guard nextMode != mode else { return }
            onSelect(nextMode)
        }
        .onChange(of: mode) { _, nextMode in
            crownValue = nextMode.crownValue
            crownFocused = true
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var accent: Color {
        mode == .freedive ? DiveWatchTheme.primary : DiveWatchTheme.secondary
    }

    private var systemImage: String {
        mode == .freedive ? "figure.pool.swim" : "drop.fill"
    }

    private func modeButton(_ candidate: DiveMode) -> some View {
        Button {
            onSelect(candidate)
        } label: {
            Text(candidate.label)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 30)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(candidate == mode ? accent.opacity(0.28) : DiveWatchTheme.surfaceRaised)
                )
        }
        .buttonStyle(.plain)
    }
}

private extension DiveMode {
    var crownValue: Double {
        self == .freedive ? 0 : 1
    }
}
```

- [ ] **Step 5: Route water state and the locked plan through SwiftUI**

In `HomeView`, add this modifier beside the existing appearance handling:

```swift
.onChange(of: water.latestState) { _, nextState in
    realCoordinator.receiveWaterState(nextState)
}
```

At the end of the existing `.onAppear`, add:

```swift
realCoordinator.receiveWaterState(water.latestState)
```

In `RealRecordingFlowView`, add Wet Ready and use the associated recording plan:

```swift
case .wetReady(let mode):
    WetReadyView(
        mode: mode,
        currentDepthMeters: water.latestDepthMeters,
        onSelect: coordinator.selectWetReadyMode
    )
case .recording(_, let plan):
    RecordingInstrumentView(
        recorder: recorder,
        plan: plan,
        maximumDepthMeters: water.maximumDepthMeters,
        endControl: WatchRecordingMode.real.endControl,
        onEndDive: nil
    )
```

Do not read `store.preferredDiveMode` from the recording case. Keep the existing summary and error cases unchanged until Task 3.

In `DiveAppServices`, wire the write boundary:

```swift
let realCoordinator = RealDiveSessionCoordinator(
    preferredMode: { store.preferredDiveMode },
    updatePreferredMode: store.updatePreferredDiveMode,
    runtime: runtime,
    recorder: realRecorder,
    water: water,
    actionButtonDonor: actionButtonDonor
)
```

- [ ] **Step 6: Add WetReadyView to the Xcode project**

Use the unused IDs `F10000000000000000000001` and `F20000000000000000000001`. Add:

```text
F10000000000000000000001 /* WetReadyView.swift in Sources */ = {isa = PBXBuildFile; fileRef = F20000000000000000000001 /* WetReadyView.swift */; };
```

to `PBXBuildFile`, add:

```text
F20000000000000000000001 /* WetReadyView.swift */ = {isa = PBXFileReference; includeInIndex = 1; lastKnownFileType = sourcecode.swift; path = WetReadyView.swift; sourceTree = "<group>"; };
```

to `PBXFileReference`, add the file reference after `HomeView.swift` in the Views group, and add the build-file reference after `HomeView.swift in Sources` in the Watch target `E3A8DB1C792D6C28097C1986` Sources phase.

- [ ] **Step 7: Add complete Wet Ready localization and static UI checks**

Add these English/Korean values to `Localizable.xcstrings` using the existing catalog structure:

```text
Ready
  en: Ready
  ko: 준비됨

Underwater recording starts automatically.
  en: Underwater recording starts automatically.
  ko: 수중 세션이 시작되면 자동으로 기록합니다.

Rotate the Digital Crown to choose a mode.
  en: Rotate the Digital Crown to choose a mode.
  ko: 디지털 크라운을 돌려 모드를 선택하세요.
```

Add `ios/DivenaryWatchApp/Views/WetReadyView.swift` and `ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift` to `watchSourceFiles` in `check-watch-ui-language.mjs`. Add:

```javascript
const wetReadyViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/WetReadyView.swift'),
  'utf8',
);
```

and this check:

```javascript
{
  name: 'wet ready uses crown selection without a crown-press confirmation',
  failed:
    !wetReadyViewSource.includes('.digitalCrownRotation(') ||
    /press.*Digital Crown/i.test(wetReadyViewSource),
},
```

- [ ] **Step 8: Run focused tests, UI checks, and the watch build**

Run the Task 2 Step 2 focused coordinator test command again, then:

```bash
yarn workspace @repo/mobile watch:ui:check
yarn watch:build
```

Expected: coordinator tests pass; the UI language checker exits 0; the `DivenaryWatchApp` scheme builds for `generic/platform=watchOS Simulator` with code signing disabled.

- [ ] **Step 9: Review and commit Wet Ready**

```bash
git diff --check -- apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings apps/mobile/ios/Divenary.xcodeproj/project.pbxproj apps/mobile/scripts/check-watch-ui-language.mjs
git diff -- apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings apps/mobile/ios/Divenary.xcodeproj/project.pbxproj apps/mobile/scripts/check-watch-ui-language.mjs
git add apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings apps/mobile/ios/Divenary.xcodeproj/project.pbxproj apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): add wet-ready mode selection"
```

Expected: Wet Ready and its focused tests are committed without generated contract or `.turbo` cache files.

### Task 3: Automatically Persist Real Completion And Remove Wet Metadata Input

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs`

**Interfaces:**
- Consumes: Task 2's locked `recording(source:plan:)` phase and existing idempotent `DiveSessionStore.save(_:)` behavior.
- Produces: `DiveSessionPersisting.save(_:)`, `RealDivePhase.completing(record:)`, `savedSummary(record:)`, `startPersistenceError(source:)`, `savePersistenceError(record:)`, `retryCompletedSessionSave()`, `dismissSavedSummary()`, `SavedSessionSummaryView`, and `CapturedSessionSummaryView`.

- [ ] **Step 1: Add failing automatic-save and recovery tests**

Add these tests to `RealDiveSessionCoordinatorTests` and replace the existing manual `markSummarySaved`/`discardSummary` assertions:

```swift
func testRuntimeInvalidationWithSamplesAutomaticallySavesExactlyOnce() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1).applyingPostDive(
        rating: nil,
        perceivedExertion: nil,
        visibilityRating: nil,
        waterCondition: .unknown,
        notes: nil
    )
    let recorder = FakeDiveRecorder(
        calls: calls,
        hasCapturedDepthSample: true,
        stopResult: record
    )
    let sessionStore = FakeDiveSessionStore(saveResults: [true])
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        sessionStore: sessionStore
    )
    coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))

    runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
    runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

    XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id])
    XCTAssertEqual(recorder.stopCallCount, 1)
    XCTAssertEqual(recorder.resetCompletedSessionCallCount, 1)
    let saved = assertSavedSummary(coordinator)
    XCTAssertNil(saved.rating)
    XCTAssertNil(saved.perceivedExertion)
    XCTAssertNil(saved.visibilityRating)
    XCTAssertNil(saved.notes)
    XCTAssertEqual(saved.waterCondition, .unknown)
}

func testSaveFailureRetainsRecordAndRetriesSameSessionID() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    let recorder = FakeDiveRecorder(
        calls: calls,
        hasCapturedDepthSample: true,
        stopResult: record
    )
    let sessionStore = FakeDiveSessionStore(saveResults: [false, true])
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        sessionStore: sessionStore
    )
    coordinator.startManual(plan: PreDivePlan())
    runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

    assertSavePersistenceError(coordinator, recordID: record.id)
    XCTAssertEqual(recorder.resetCompletedSessionCallCount, 0)

    coordinator.retryCompletedSessionSave()
    coordinator.retryCompletedSessionSave()

    XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id, record.id])
    XCTAssertEqual(recorder.resetCompletedSessionCallCount, 1)
    XCTAssertEqual(assertSavedSummary(coordinator).id, record.id)
}

func testDismissSavedSummaryOnlyChangesUIState() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    let recorder = FakeDiveRecorder(
        calls: calls,
        hasCapturedDepthSample: true,
        stopResult: record
    )
    let sessionStore = FakeDiveSessionStore(saveResults: [true])
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        sessionStore: sessionStore
    )
    coordinator.startManual(plan: PreDivePlan())
    runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

    coordinator.dismissSavedSummary()
    coordinator.dismissSavedSummary()

    assertIdle(coordinator)
    XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id])
    XCTAssertEqual(recorder.cancelCallCount, 0)
}

func testNoSampleAutoLaunchStillDoesNotSave() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: false)
    let sessionStore = FakeDiveSessionStore(saveResults: [true])
    let coordinator = makeCoordinator(
        runtime: runtime,
        recorder: recorder,
        sessionStore: sessionStore
    )
    runtime.emit(.adoptedSystemSession)

    runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

    assertIdle(coordinator)
    XCTAssertTrue(sessionStore.saveAttempts.isEmpty)
}
```

Add these fakes/helpers and extend `makeCoordinator` with a default successful fake store:

```swift
@MainActor
private final class FakeDiveSessionStore: DiveSessionPersisting {
    private var saveResults: [Bool]
    private(set) var saveAttempts: [DiveSessionRecord] = []

    init(saveResults: [Bool] = [true]) {
        self.saveResults = saveResults
    }

    func save(_ session: DiveSessionRecord) -> Bool {
        saveAttempts.append(session)
        return saveResults.isEmpty ? true : saveResults.removeFirst()
    }
}

@discardableResult
private func assertSavedSummary(
    _ coordinator: RealDiveSessionCoordinator,
    file: StaticString = #filePath,
    line: UInt = #line
) -> DiveSessionRecord {
    guard case let .savedSummary(record) = coordinator.phase else {
        XCTFail("Expected saved-summary phase, received \(coordinator.phase)", file: file, line: line)
        return DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    }
    return record
}

private func assertSavePersistenceError(
    _ coordinator: RealDiveSessionCoordinator,
    recordID: UUID,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    guard case let .savePersistenceError(record) = coordinator.phase else {
        return XCTFail("Expected save-persistence-error phase", file: file, line: line)
    }
    XCTAssertEqual(record.id, recordID, file: file, line: line)
}
```

Rename the existing start error assertion to `assertStartPersistenceError` and update its pattern to `.startPersistenceError(source:)`.

- [ ] **Step 2: Run coordinator tests and verify RED**

Run the focused coordinator test command from Task 2 Step 2.

Expected: compilation fails because persistence protocol, automatic-save phases, retry, and saved-summary dismissal do not exist.

- [ ] **Step 3: Add the local persistence boundary and automatic finalizer**

Add this protocol near `DiveSessionRecording`:

```swift
@MainActor
protocol DiveSessionPersisting: AnyObject {
    @discardableResult
    func save(_ session: DiveSessionRecord) -> Bool
}
```

Make the existing store conform without changing `save`:

```swift
extension DiveSessionStore: DiveSessionPersisting {}
```

Add a Debug-only fail-first decorator in `DiveAppServices.swift` so the physical recovery gate is reproducible from an Xcode launch environment:

```swift
#if DEBUG
@MainActor
final class FailFirstDiveSessionPersisting: DiveSessionPersisting {
    private let base: any DiveSessionPersisting
    private var shouldFail = true

    init(base: any DiveSessionPersisting) {
        self.base = base
    }

    func save(_ session: DiveSessionRecord) -> Bool {
        guard !shouldFail else {
            shouldFail = false
            return false
        }
        return base.save(session)
    }
}
#endif
```

Select the persistence dependency in `DiveAppServices.init()` without changing the published `store`:

```swift
let completionStore: any DiveSessionPersisting
#if DEBUG
if ProcessInfo.processInfo.environment["DIVE_WATCH_FAIL_FIRST_COMPLETION_SAVE"] == "1" {
    completionStore = FailFirstDiveSessionPersisting(base: store)
} else {
    completionStore = store
}
#else
completionStore = store
#endif
```

Pass `sessionStore: completionStore` to `RealDiveSessionCoordinator`. The Debug variable fails exactly the first completion save in the current process and never changes Release behavior.

Replace the old summary and generic persistence-error phase cases with:

```swift
case completing(record: DiveSessionRecord)
case savedSummary(record: DiveSessionRecord)
case startPersistenceError(source: RealDiveStartSource)
case savePersistenceError(record: DiveSessionRecord)
```

Include all four in `presentsRecordingFlow`. Inject `sessionStore: any DiveSessionPersisting` into `RealDiveSessionCoordinator` and `DiveAppServices`.

Replace `finalizeAfterRuntimeInvalidation`'s final summary assignment and remove `markSummarySaved`/`discardSummary` from the real coordinator. Add:

```swift
func retryCompletedSessionSave() {
    guard case let .savePersistenceError(record) = phase else { return }
    persistCompletedRecord(record)
}

func dismissSavedSummary() {
    guard case .savedSummary = phase else { return }
    phase = .idle
}

private func persistCompletedRecord(_ record: DiveSessionRecord) {
    phase = .completing(record: record)
    guard sessionStore.save(record) else {
        phase = .savePersistenceError(record: record)
        return
    }

    recorder.resetCompletedSession()
    phase = .savedSummary(record: record)
}
```

End `finalizeAfterRuntimeInvalidation` with:

```swift
persistCompletedRecord(record)
```

Rename existing setup/start error transitions and dismissal method to `startPersistenceError` and `dismissStartPersistenceError()`. Do not allow start-error dismissal to touch a retained completed record.

- [ ] **Step 4: Split shared metrics from completion actions**

In `SummaryView.swift`:

1. Rename `SummaryView` to `SessionSummaryContent`.
2. Replace the fixed `Dive captured` status with a `statusTitle: LocalizedStringKey` property.
3. Delete `rating`, `perceivedExertion`, `visibilityRating`, `waterCondition`, and `notes` state.
4. Delete the entire `POST-DIVE REVIEW` card, Save button, Discard button, `.onAppear`, and `StarRatingControl` type.
5. Keep the header/profile, mode summary, common metrics, and non-certified disclaimer unchanged.

Add these wrappers above the private mode-summary types:

```swift
struct SavedSessionSummaryView: View {
    let session: DiveSessionRecord
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            SessionSummaryContent(session: session, statusTitle: "Saved")

            Text("Edit details on iPhone.")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .multilineTextAlignment(.center)

            Button("Done", action: onDone)
                .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }
}

struct CapturedSessionSummaryView: View {
    let session: DiveSessionRecord
    let onSave: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            SessionSummaryContent(session: session, statusTitle: "Dive captured")

            HStack(spacing: 8) {
                Button("Save", action: onSave)
                    .buttonStyle(DiveActionButtonStyle(kind: .primary))

                Button("Discard", role: .destructive, action: onDiscard)
                    .buttonStyle(DiveActionButtonStyle(kind: .secondary))
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }
}
```

Keep the summary scroll independently scrollable so the wrapper actions stay reachable on all supported sizes.

- [ ] **Step 5: Route real save/retry and simulated explicit actions**

Remove `store` from `RealRecordingFlowView`. Add:

```swift
@Environment(\.scenePhase) private var scenePhase
```

Use these completion cases:

```swift
case .completing:
    savingView
case .savedSummary(let session):
    SavedSessionSummaryView(
        session: session,
        onDone: coordinator.dismissSavedSummary
    )
case .savePersistenceError:
    savePersistenceErrorView
case .startPersistenceError:
    startPersistenceErrorView(allowsDismissal: true)
```

Rename the current setup error builder to `startPersistenceErrorView` and make its Done action call `dismissStartPersistenceError()`.

Add:

```swift
private var savingView: some View {
    VStack(spacing: 10) {
        ProgressView()
            .tint(DiveWatchTheme.primary)
        Text("Saving log")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.text)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(DiveWatchTheme.background.ignoresSafeArea())
}

private var savePersistenceErrorView: some View {
    VStack(spacing: 10) {
        Image(systemName: "externaldrive.badge.exclamationmark")
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.danger)

        Text("Keeping your captured log.")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.text)
            .multilineTextAlignment(.center)

        Button("Retry Save") {
            coordinator.retryCompletedSessionSave()
        }
        .buttonStyle(DiveActionButtonStyle(kind: .primary))
    }
    .padding(.horizontal, DiveWatchTheme.edgeMargin)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(DiveWatchTheme.background.ignoresSafeArea())
}
```

Add foreground retry to the outer view:

```swift
.onChange(of: scenePhase) { _, nextPhase in
    if nextPhase == .active {
        coordinator.retryCompletedSessionSave()
    }
}
```

Remove `store: store` from the `RealRecordingFlowView` call in `HomeView`.

In `SimulatedRecordingFlowView`, replace the old summary call with:

```swift
CapturedSessionSummaryView(
    session: session,
    onSave: { save(session) },
    onDiscard: discard
)
```

This keeps simulated Save/Discard but never applies invented subjective values.

- [ ] **Step 6: Correct end copy and add localization**

Replace the real Crown hint in `RecordingView.swift` with:

```swift
footerHint(
    String(localized: "End with the configured Action Button or by turning off Water Lock.")
)
```

Add these complete English/Korean entries to `Localizable.xcstrings`:

```text
Saved
  en: Saved
  ko: 저장됨

Edit details on iPhone.
  en: Edit details on iPhone.
  ko: 세부 정보는 iPhone에서 편집할 수 있습니다.

Saving log
  en: Saving log
  ko: 로그 저장 중

Keeping your captured log.
  en: Keeping your captured log.
  ko: 캡처한 로그를 보존하고 있습니다.

Retry Save
  en: Retry Save
  ko: 저장 재시도

End with the configured Action Button or by turning off Water Lock.
  en: End with the configured Action Button or by turning off Water Lock.
  ko: 설정된 동작 버튼을 사용하거나 수중 잠금을 해제해 기록을 종료하세요.
```

- [ ] **Step 7: Add static regression checks for wet completion**

In `check-watch-ui-language.mjs`, add:

```javascript
const summaryViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/SummaryView.swift'),
  'utf8',
);
const realRecordingFlowSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift'),
  'utf8',
);
```

Add these checks:

```javascript
{
  name: 'watch summary omits subjective post-dive input',
  pattern: /StarRatingControl|POST-DIVE REVIEW|TextField\("Quick note"/,
  source: summaryViewSource,
},
{
  name: 'real recording flow delegates persistence to the coordinator',
  failed:
    realRecordingFlowSource.includes('store.save(') ||
    realRecordingFlowSource.includes('onDiscard:'),
},
{
  name: 'real recording copy does not claim crown-press handling',
  failed: /press and hold the Digital Crown/i.test(recordingViewSource),
},
```

Before filtering failures, normalize per-check source by replacing the current final line with:

```javascript
const failures = checks.filter(check =>
  check.failed ?? check.pattern.test(check.source ?? source),
);
```

- [ ] **Step 8: Run focused coordinator tests and verify GREEN**

Run the exact focused coordinator command from Task 2 Step 2.

Expected: all coordinator tests pass, including existing Action Button, invalidation, cleanup, recovery, and no-sample tests plus the new auto-save tests.

- [ ] **Step 9: Run full watch tests, UI checks, and build**

```bash
xcodebuild test \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO
yarn workspace @repo/mobile watch:ui:check
yarn watch:build
```

Expected: all `DivenaryWatchAppTests` pass; language checks exit 0; the Watch app builds with code signing disabled. CoreSimulator log-permission warnings are environmental when each command exits 0.

- [ ] **Step 10: Review and commit automatic save and summaries**

```bash
git diff --check -- apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings apps/mobile/scripts/check-watch-ui-language.mjs
git diff -- apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings apps/mobile/scripts/check-watch-ui-language.mjs
git add apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): save completed sessions automatically"
```

Expected: automatic real save, read-only real summary, explicit simulated actions, recovery UI, tests, and checks are committed without unrelated cache files.

### Task 4: Record The Runtime Decision And Run Repository Gates

**Files:**
- Modify: `docs/2026-07-18-watch-underwater-runtime-device-checklist.md`
- Create: `.wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md`
- Modify: `.wiki/wiki/architecture/watch-app.md`
- Modify: `.wiki/wiki/project/diving-app-qa-test-plan.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes: implemented behavior from Tasks 1-3 and `docs/superpowers/specs/2026-09-01-watch-wet-ready-auto-save-design.md`.
- Produces: durable Korean architecture/QA knowledge and an explicit supported-device evidence gate; no new runtime code or contract behavior.

- [ ] **Step 1: Load the required Wiki workflows before editing**

Read and follow:

```text
.agents/skills/karpathy-llm-wiki/SKILL.md
.agents/skills/wiki-writing/SKILL.md
```

Read only the directly required raw-template, ingest, lint, and repository-style references those skills route to. Do not mark physical behavior verified from simulator evidence.

- [ ] **Step 2: Update the physical-device checklist**

In `docs/2026-07-18-watch-underwater-runtime-device-checklist.md`:

1. Change D4a evidence to require simulator coverage of both event orders: Wet Ready before adopted runtime and runtime-first preferred-mode fallback.
2. Change D4b to require physical shallow-submersion Wet Ready display, active Water Lock, Crown selection, and subsequent `systemAutoLaunch` adoption at the platform-provided threshold.
3. Change D5 to require the selected Wet Ready mode to remain the recording mode even if the stored preference is changed after recording begins.
4. Change D6 to require exactly one locally saved summary with no post-dive input or Save tap after runtime invalidation.
5. Add D13 with this row content:

```markdown
| D13 | Debug-only forced local-save failure로 sample이 있는 real session을 종료한 뒤 같은 화면에서 자동 retry와 수동 Retry를 각각 실행한다. | `Saved`가 조기 표시되지 않고 같은 local session ID가 유지되며, 성공 뒤 saved session은 정확히 하나다. recorder cleanup은 성공 뒤 한 번만 발생한다. | 실패 record 소실, ID 변경, 중복 session, 조기 cleanup, retry log. | required recovery gate |
```

Update the deployment decision from `D1-D12` to `D1-D13`. Keep D4b, D5, D6, and D13 `NOT RUN` until physical evidence is attached.

- [ ] **Step 3: Create the immutable Wiki raw source**

Create `.wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md` with:

```markdown
Source URL: docs/superpowers/specs/2026-09-01-watch-wet-ready-auto-save-design.md; docs/superpowers/plans/2026-09-01-watch-wet-ready-auto-save.md; local implementation
Collected: 2026-09-01
Published: 2026-09-01

# Watch Wet Ready and automatic local save

지원 hardware에서 물 감지와 watchOS underwater extended runtime 전달 사이에는 앱이 foreground에 있지만 Water Lock 때문에 touch를 사용할 수 없는 구간이 생길 수 있다. Divenary는 이 구간에 전체 Home 대신 `wetReady(mode:)`를 표시한다. 마지막 preferred mode를 기본값으로 사용하고 Digital Crown 회전으로 Freedive 또는 Scuba를 즉시 선택한다. Crown press는 watchOS system behavior이므로 앱 확인 입력으로 사용하지 않는다.

물 감지 자체, app-local depth threshold, 30초 timer는 recording start가 아니다. watchOS가 underwater runtime을 전달하면 coordinator가 현재 armed mode를 `PreDivePlan`에 고정하고 recorder를 한 번 시작한다. runtime이 water UI event보다 먼저 오면 persisted preferred mode를 fallback으로 사용한다. recording 뒤에는 mode를 바꾸지 않는다.

sample이 있는 real recording이 runtime invalidation으로 끝나면 coordinator가 finalized `DiveSessionRecord`를 Watch local store에 먼저 저장한다. 성공 뒤에만 recorder completed state를 정리하고 `Saved` summary를 표시한다. 실패하면 같은 record와 local session ID를 유지한 채 foreground 또는 명시적 Retry에서 다시 저장한다. real completion에는 rating, perceived exertion, visibility, water condition, note 입력과 Save/Discard/Delete가 없다. 미입력 주관 값은 `nil`, water condition은 `.unknown`이다.

Demo/debug는 read-only metrics를 공유하지만 test data 누적 방지를 위해 explicit Save/Discard를 유지한다. Watch local save와 mobile import ACK, account cloud sync, guest claim은 서로 다른 완료 경계다.

Simulator와 build는 physical Water Lock, Crown focus, actual `When Submerged` automatic launch, sensor delivery 또는 release readiness의 증거가 아니다. 지원 Apple Watch에서 shallow Wet Ready, Crown selection, runtime adoption, mode lock, touch 없는 local save, forced save-retry를 별도 검증해야 한다.
```

- [ ] **Step 4: Compile the architecture and QA articles**

In `.wiki/wiki/architecture/watch-app.md`:

- append `Watch Wet Ready and automatic local save, 2026-09-01` and its raw link to Sources/Raw;
- set `Updated: 2026-09-01`;
- revise `## 시작 규칙` to record Wet Ready, Crown selection, runtime adoption, runtime-first fallback, no app-owned depth/time trigger, and immutable active plan;
- revise `## 종료와 결과 규칙` to replace one-summary-before-save wording with automatic local save, retained-record retry, read-only saved summary, and unchanged no-sample policy;
- state that Crown press remains a system Water Lock action, not an app input.

In `.wiki/wiki/project/diving-app-qa-test-plan.md`:

- append the new source/raw link and set `Updated: 2026-09-01`;
- add automated coordinator coverage for both event orders, two-second dry debounce, mode lock, automatic save, same-ID retry, and no-sample non-save;
- update Gate C with physical Water Lock Crown selection, system adoption, touchless saved summary, and forced save failure/retry evidence;
- keep actual underwater behavior pending.

Update the Watch 앱 구조 and Diving App / QA and Test Plan rows in `.wiki/wiki/index.md` to `2026-09-01` without changing unrelated rows.

Append to `.wiki/wiki/log.md`:

```markdown

## [2026-09-01] ingest | Watch Wet Ready and automatic local save
- Added: Watch Wet Ready and automatic local save raw source
- Updated: Watch 앱 구조
- Updated: Diving App / QA and Test Plan
- Updated: Knowledge Base Index
- Recorded: 물 감지 뒤 Wet Ready에서 Crown으로 Freedive/Scuba를 선택하고 watchOS runtime adoption 순간 mode와 plan을 고정한다.
- Recorded: sample이 있는 real completion은 Watch local save 성공 뒤에만 Saved summary를 표시하며 실패 시 같은 local session ID를 유지해 재시도한다.
- Clarified: app-local 1m/3m/30초 start trigger와 active-session mode change, wet post-dive metadata 입력, immediate delete는 구현하지 않는다.
- Pending: physical Water Lock Crown focus, actual When Submerged ordering, touchless save, forced save-retry는 지원 hardware evidence가 필요하다.
```

- [ ] **Step 5: Run the repository Wiki lint workflow**

The repository Wiki skill defines lint as deterministic link/index/source checks plus a heuristic contradiction review; it does not provide a standalone lint executable. Run the deterministic checks explicitly:

```bash
test -f .wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md
rg -n "2026-09-01-watch-wet-ready-auto-save\.md" .wiki/wiki/architecture/watch-app.md .wiki/wiki/project/diving-app-qa-test-plan.md
rg -n "\[Watch 앱 구조\]\(architecture/watch-app\.md\).*2026-09-01|\[Diving App / QA and Test Plan\]\(project/diving-app-qa-test-plan\.md\).*2026-09-01" .wiki/wiki/index.md
node -e 'const fs=require("fs"),path=require("path");const files=[".wiki/wiki/architecture/watch-app.md",".wiki/wiki/project/diving-app-qa-test-plan.md",".wiki/wiki/index.md"];const bad=[];for(const file of files){const text=fs.readFileSync(file,"utf8");for(const match of text.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g)){const link=match[1];if(/^[a-z]+:/i.test(link))continue;const target=path.resolve(path.dirname(file),link.split("#")[0]);if(!fs.existsSync(target))bad.push(`${file}: ${link}`)}}if(bad.length){console.error(bad.join("\n"));process.exit(1)}'
```

Expected: the raw source exists; both compiled articles cite it; both index rows carry `2026-09-01`; the Node link check exits 0 without output.

Run the heuristic contradiction review:

```bash
rg -n "preferredDiveMode|system auto-launch|Wet Ready|Saved|summary|post-dive|Water Lock|Digital Crown|1.?m|3.?m|30.?초" .wiki/wiki/architecture/watch-app.md .wiki/wiki/project/diving-app-qa-test-plan.md
```

Review every match. There must be no statement that system auto-launch directly starts the preferred mode without Wet Ready, no claim that Crown press is an app input, no wet post-dive metadata entry, no app-owned 1m/3m/30-second start trigger, and no claim that pending physical checks have passed.

After the deterministic checks and heuristic review pass, append the manual lint record to `.wiki/wiki/log.md`:

```markdown

## [2026-09-01] lint | 0 issues found, 0 auto-fixed
```

- [ ] **Step 6: Run final automated verification**

```bash
xcodebuild test \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO
yarn workspace @repo/mobile watch:ui:check
yarn watch:build
yarn codex:check
```

Expected: all watch tests pass; UI language checks exit 0; `yarn watch:build` exits 0 for project `apps/mobile/ios/Divenary.xcodeproj`, scheme `DivenaryWatchApp`, destination `generic/platform=watchOS Simulator`; `yarn codex:check` exits 0 after contract generation, mobile typecheck, and the watch build. Environment warnings are not failures when the command exits 0.

- [ ] **Step 7: Audit scope, generated output, and physical claims**

```bash
git status --short
git diff --check
git diff --stat
git diff -- packages/contracts/generated
rg -n "1.?m|3.?m|30.?second|30.?초" apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift
rg -n "StarRatingControl|POST-DIVE REVIEW|Quick note" apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift
```

Expected:

- generated contract diff is empty;
- the new real auto-start code contains no 1m, 3m, or 30-second start threshold;
- the read-only summary contains no subjective post-dive controls;
- physical checklist items remain not-run unless supported-device evidence was actually collected;
- only task files plus pre-existing `.turbo` cache changes appear in status.

- [ ] **Step 8: Commit documentation and verification records**

```bash
git diff --check -- docs/2026-07-18-watch-underwater-runtime-device-checklist.md .wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md .wiki/wiki/architecture/watch-app.md .wiki/wiki/project/diving-app-qa-test-plan.md .wiki/wiki/index.md .wiki/wiki/log.md
git diff -- docs/2026-07-18-watch-underwater-runtime-device-checklist.md .wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md .wiki/wiki/architecture/watch-app.md .wiki/wiki/project/diving-app-qa-test-plan.md .wiki/wiki/index.md .wiki/wiki/log.md
git add docs/2026-07-18-watch-underwater-runtime-device-checklist.md .wiki/raw/architecture/2026-09-01-watch-wet-ready-auto-save.md .wiki/wiki/architecture/watch-app.md .wiki/wiki/project/diving-app-qa-test-plan.md .wiki/wiki/index.md .wiki/wiki/log.md
git commit -m "docs: record watch wet-ready behavior"
git status --short
```

Expected: implementation knowledge and pending physical gates are committed. The only remaining changes are pre-existing unrelated `.turbo` cache files.

## Completion Criteria

- A shallow submersion event presents Wet Ready without starting the recorder.
- Crown rotation changes and persists the armed Freedive/Scuba mode without Crown press or touch confirmation.
- watchOS runtime adoption starts the armed mode, while runtime-first ordering uses preferred mode.
- The active recording renders from its immutable plan and rejects later mode changes.
- A stable dry state dismisses Wet Ready after 2 seconds without creating a session.
- A completed sampled real session is locally saved exactly once semantically before `Saved` appears.
- Save failure retains the same record and session ID; retry succeeds without duplicate saved sessions or premature recorder cleanup.
- Real completion has no subjective metadata input, Save, Discard, or Delete; Demo/debug keeps explicit Save/Discard.
- No contract, Watch ACK, cloud sync, claim, entitlement, signing, or safety meaning changes.
- Focused tests, full watch tests, UI checks, watch build, repository checks, and Wiki lint pass.
- Physical behavior remains explicitly pending until the updated D1-D13 checklist has supported-device evidence.
