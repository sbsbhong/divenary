# Watch Debug Demo Sync Logbook UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the accepted watch debug/demo, mobile logbook sync status, pressure metadata, badge styling, and safety-stop UX changes from `docs/superpowers/specs/2026-07-07-watch-debug-demo-sync-logbook-ux-design.md`.

**Architecture:** Keep one `DiveWatchApp` target and add a shared debug scheme only. Watch Demo and Debug test sessions use the normal recording/store/sync path with `captureMode: .demo`, while mobile logbook status is displayed as future cloud sync state and therefore remains pending until a cloud backend exists.

**Tech Stack:** SwiftUI/watchOS, Xcode shared schemes, XCTest, React Native 0.85, TypeScript, Jest, React Test Renderer, Yarn 1, Karpathy LLM Wiki.

---

## Execution Rules

- Work from `/Users/hongseongbin/Projects/diving-app/.worktrees/watch-debug-demo-sync-ux`.
- Do not change bundle identifiers, signing, provisioning, entitlements, or create a new watch target.
- Do not add dependencies.
- Do not modify generated contract output directly.
- Keep safety-stop copy and wiki text within non-certified reminder/logging scope.
- Subagents edit code and report changed files. The coordinator performs final staging and commit after all tasks and verification.
- For every behavior change, write or update the failing test first, run it, then implement.

## Baseline

- `yarn install --frozen-lockfile`: passed.
- `yarn mobile:typecheck`: passed.
- `yarn watch:build`: failed inside sandbox with SwiftUI `#Preview` macro plugin error, then passed with escalation.
- `xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'generic/platform=watchOS Simulator' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO build-for-testing`: passed.
- `xcodebuild test` requires a concrete watchOS simulator. Available concrete test destination: `platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5`.

## File Structure

- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
  - Owns safety-stop countdown, pause, reset, and records.
- `apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift`
  - Delegates scuba samples to safety-stop controller.
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
  - Owns recording mode, live instrument layout, Digital Crown demo depth control, and surface-gated end button.
- `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
  - Renders the reusable depth gauge with parent-driven height.
- `apps/mobile/ios/DiveWatchApp/Sensors/DemoDepthSensorProvider.swift`
  - Emits deterministic demo/debug samples from controlled depth and automatic temperature.
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
  - Adds debug-only Test Freedive/Test Scuba entry points.
- `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchAppDebug.xcscheme`
  - New shared scheme for debug test controls with the same target and bundle id.
- `apps/mobile/ios/DiveWatchAppTests/SafetyStopControllerTests.swift`
  - Adds safety-stop reset tests.
- `apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift`
  - Adds small tests for surface end gate and debug recording mode helpers.
- `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
  - Source-level watch UI/scheme guard tests.
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
  - Creates imported watch logs with cloud sync `pending`.
- `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - Saves imported/enriched watch logs without marking cloud sync success.
- `apps/mobile/src/screens/logbook/screen.tsx`
  - Displays current logbook cloud sync state as pending unless local-only.
- `apps/mobile/src/screens/home/screen.tsx`
  - Displays latest imported log cloud sync state consistently.
- `apps/mobile/src/components/ui/instrument.tsx`
  - Makes status pills low-chroma and non-button-like.
- `apps/mobile/src/utils/dive-log-sync-status.ts`
  - New small mobile helper for visible cloud-sync status mapping.
- `apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts`
- `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- `apps/mobile/__tests__/App.test.tsx`
  - Mobile regression tests.
- `.wiki/raw/decisions/2026-07-07-watch-debug-demo-sync-logbook-ux.md`
  - Immutable source summary of accepted decision and implemented behavior.
- `.wiki/wiki/architecture/watch-app.md`
- `.wiki/wiki/architecture/sync-flow.md`
- `.wiki/wiki/domains/dive-log.md`
- `.wiki/wiki/domains/safety-rules.md`
- `.wiki/wiki/questions/open-questions.md`
- `.wiki/wiki/index.md`
- `.wiki/wiki/log.md`
  - Durable knowledge updates.

---

### Task 1: Watch Safety Stop Reset And Deep-Exit Routing

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DiveWatchAppTests/SafetyStopControllerTests.swift`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`

- [ ] **Step 1: Write failing Swift tests for reset policy**

Add these tests to `SafetyStopControllerTests` before the status text safety copy test:

```swift
    func testOutsideCountingZoneForLessThanResetThresholdPreservesTimer() {
        var controller = activeControllerWithTenSecondsCredited()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(20, depth: 6.8))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(49, depth: 6.8))

        XCTAssertEqual(controller.record.status, .pausedTooDeep)
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 10, accuracy: 0.01)
        XCTAssertEqual(controller.record.startedAt, EngineTestFixtures.date(2))
    }

    func testOutsideCountingZoneForResetThresholdRestartsTimer() {
        var controller = activeControllerWithTenSecondsCredited()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(20, depth: 6.8))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(50, depth: 6.8))

        XCTAssertEqual(controller.record.status, .pausedTooDeep)
        XCTAssertEqual(controller.record.remainingSeconds, 180, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 0, accuracy: 0.01)
        XCTAssertNil(controller.record.startedAt)
    }

    func testReEnteringZoneAfterResetStartsCountdownFromBeginning() {
        var controller = activeControllerWithTenSecondsCredited()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(20, depth: 6.8))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(50, depth: 6.8))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(55, depth: 5))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(65, depth: 5))

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.startedAt, EngineTestFixtures.date(55))
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 10, accuracy: 0.01)
    }
```

Add this helper near `activeController()`:

```swift
    private func activeControllerWithTenSecondsCredited() -> SafetyStopController {
        var controller = activeController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(12, depth: 5))
        return controller
    }
```

- [ ] **Step 2: Write failing JS source test for too-deep UI routing**

In `watch-connectivity-native-source.test.ts`, update the safety-stop routing assertion:

```ts
    expect(safetyStopRouting).toContain('case .active, .pausedTooShallow, .completed:');
    expect(safetyStopRouting).toContain('case .pausedTooDeep, .armed, .unknown, .notRequired, .skippedOrIncomplete:');
```

- [ ] **Step 3: Verify red**

Run:

```bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test -only-testing:DiveWatchAppTests/SafetyStopControllerTests
```

Expected: FAIL because the 30s reset behavior is not implemented.

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/watch-connectivity-native-source.test.ts -t "keeps mode-specific live instruments"
```

Expected: FAIL because `RecordingView` still routes `.pausedTooDeep` to the safety-stop instrument.

- [ ] **Step 4: Implement minimal controller reset state**

In `SafetyStopConfiguration`, add:

```swift
    var outOfZoneResetSeconds: TimeInterval = 30
```

In `SafetyStopController`, add a private property:

```swift
    private var outsideZoneStartedAt: Date?
```

In `.inside` handling, clear the outside-zone tracker before crediting time:

```swift
            outsideZoneStartedAt = nil
```

Replace the `.tooDeep` and `.tooShallow` cases with:

```swift
        case .tooDeep:
            if startedAt != nil {
                updateOutsideZoneState(status: .pausedTooDeep, sample: sample)
            }
        case .tooShallow:
            if startedAt != nil {
                updateOutsideZoneState(status: .pausedTooShallow, sample: sample)
            }
```

Add this helper before `elapsedSinceLastSample`:

```swift
    private mutating func updateOutsideZoneState(status nextStatus: SafetyStopStatus, sample: DepthSample) {
        if outsideZoneStartedAt == nil {
            outsideZoneStartedAt = sample.timestamp
        }

        if let outsideZoneStartedAt,
           sample.timestamp.timeIntervalSince(outsideZoneStartedAt) >= configuration.outOfZoneResetSeconds {
            remainingSeconds = configuration.durationSeconds
            timeInZoneSeconds = 0
            startedAt = nil
            completedAt = nil
        }

        status = nextStatus
    }
```

- [ ] **Step 5: Implement too-deep UI exit**

In `RecordingView.shouldShowSafetyStopInstrument`, route too-deep to general scuba UI:

```swift
    private var shouldShowSafetyStopInstrument: Bool {
        switch recorder.scubaSafetyStop.status {
        case .active, .pausedTooShallow, .completed:
            return true
        case .pausedTooDeep, .armed, .unknown, .notRequired, .skippedOrIncomplete:
            return false
        }
    }
```

- [ ] **Step 6: Verify green**

Run the same two commands from Step 3.

Expected: PASS for the focused Swift and JS tests.

---

### Task 2: Watch Debug Scheme, Crown Demo Depth, Surface End Gate, And Live Layout

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Sensors/DemoDepthSensorProvider.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- Modify: `apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- Create: `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchAppDebug.xcscheme`

- [ ] **Step 1: Write failing Swift helper tests**

Append to `ScubaDiveEngineTests.swift` after `DepthSensorAvailabilityTests`:

```swift
final class SurfaceEndDiveGateTests: XCTestCase {
    func testEndButtonStaysHiddenUntilSurfaceDepthIsStableForThreeSeconds() {
        var gate = SurfaceEndDiveGate()

        gate.update(depthMeters: 1.0, at: EngineTestFixtures.date(0))
        XCTAssertFalse(gate.isVisible)

        gate.update(depthMeters: 1.0, at: EngineTestFixtures.date(2.9))
        XCTAssertFalse(gate.isVisible)

        gate.update(depthMeters: 1.0, at: EngineTestFixtures.date(3))
        XCTAssertTrue(gate.isVisible)
    }

    func testEndButtonHidesWhenDepthReturnsPastHysteresis() {
        var gate = SurfaceEndDiveGate()

        gate.update(depthMeters: 0.8, at: EngineTestFixtures.date(0))
        gate.update(depthMeters: 0.8, at: EngineTestFixtures.date(3))
        XCTAssertTrue(gate.isVisible)

        gate.update(depthMeters: 1.2, at: EngineTestFixtures.date(4))
        XCTAssertFalse(gate.isVisible)
    }
}

final class WatchRecordingModeTests: XCTestCase {
    func testDebugTestUsesDemoCaptureModeForExistingSyncContract() {
        XCTAssertEqual(WatchRecordingMode.debugTest.captureMode, .demo)
    }

    func testDemoAndDebugUseDemoDepthProvider() {
        XCTAssertTrue(WatchRecordingMode.demo.sensorProvider() is DemoDepthSensorProvider)
        XCTAssertTrue(WatchRecordingMode.debugTest.sensorProvider() is DemoDepthSensorProvider)
    }
}
```

- [ ] **Step 2: Write failing source tests for scheme, Crown, and layout**

In `watch-connectivity-native-source.test.ts`, add or extend tests to assert:

```ts
    const debugScheme = readRepoFile('apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchAppDebug.xcscheme');
    expect(debugScheme).toContain('DiveWatchApp.app');
    expect(debugScheme).toContain('DIVE_WATCH_DEBUG_CONTROLS');
    expect(debugScheme).not.toContain('PRODUCT_BUNDLE_IDENTIFIER');
```

Extend the watch UI source assertions:

```ts
    expect(recording).toContain('case debugTest');
    expect(recording).toContain('digitalCrownRotation');
    expect(recording).toContain('SurfaceEndDiveGate');
    expect(recording).toContain('surfaceEndGate.isVisible');
    expect(recording).toContain('recordingMode.usesCrownDepthControl');
    expect(recording).toContain('InstrumentDepthLayout');
    expect(recording).not.toContain('case .active, .pausedTooDeep, .pausedTooShallow, .completed:');
    expect(gauge).toContain('maxHeight: .infinity');
```

Add provider assertions:

```ts
    const demoProvider = readRepoFile('apps/mobile/ios/DiveWatchApp/Sensors/DemoDepthSensorProvider.swift');
    expect(demoProvider).toContain('func setDepthMeters');
    expect(demoProvider).toContain('waterTemperatureCelsius');
    expect(demoProvider).not.toContain('private func depth(for phase');
```

- [ ] **Step 3: Verify red**

Run:

```bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test -only-testing:DiveWatchAppTests/SurfaceEndDiveGateTests -only-testing:DiveWatchAppTests/WatchRecordingModeTests
```

Expected: FAIL because `SurfaceEndDiveGate`, `WatchRecordingMode.debugTest`, and controlled demo provider behavior do not exist.

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/watch-connectivity-native-source.test.ts
```

Expected: FAIL because the debug scheme and source strings do not exist.

- [ ] **Step 4: Implement debug recording mode**

In `WatchRecordingMode`, add `.debugTest`:

```swift
    case debugTest
```

Update `captureMode`:

```swift
        case .real:
            return .real
        case .demo, .debugTest:
            return .demo
```

Update `sensorProvider()`:

```swift
        case .real:
            return RealDepthSensorProvider()
        case .demo, .debugTest:
            return DemoDepthSensorProvider()
```

Add helpers:

```swift
    var usesCrownDepthControl: Bool {
        self == .demo || self == .debugTest
    }

    var markerTitle: String? {
        switch self {
        case .real:
            return nil
        case .demo:
            return String(localized: "Demo")
        case .debugTest:
            return "Test"
        }
    }
```

- [ ] **Step 5: Implement controlled demo provider**

Replace scripted depth generation in `DemoDepthSensorProvider` with controlled depth:

```swift
    private var controlledDepthMeters: Double = 0

    func setDepthMeters(_ depthMeters: Double) {
        controlledDepthMeters = max(0, min(40, depthMeters.isFinite ? depthMeters : 0))
        emitSample()
    }
```

Make `emitSample()` use `controlledDepthMeters`, pressure formula, and deterministic temperature:

```swift
        let depthMeters = controlledDepthMeters
        let pressureKPa = surfacePressureKPa + depthMeters * pressureIncreasePerMeterKPa
        let waterTemperatureCelsius = max(22.0, min(26.0, 25.0 - depthMeters * 0.06 + sin(elapsedSeconds / 18) * 0.12))
```

Remove the old `depth(for:)` curve helpers so Crown controls depth in demo/debug.

- [ ] **Step 6: Implement surface end gate**

Add a testable helper in `RecordingView.swift`:

```swift
struct SurfaceEndDiveGate: Equatable {
    private(set) var isVisible = false
    private var stableSurfaceStartedAt: Date?

    mutating func update(depthMeters: Double, at now: Date) {
        if depthMeters >= 1.2 {
            stableSurfaceStartedAt = nil
            isVisible = false
            return
        }

        guard depthMeters <= 1.0 else {
            return
        }

        if stableSurfaceStartedAt == nil {
            stableSurfaceStartedAt = now
        }

        if let stableSurfaceStartedAt,
           now.timeIntervalSince(stableSurfaceStartedAt) >= 3 {
            isVisible = true
        }
    }
}
```

In `RecordingView`, add:

```swift
    @State private var controlledDepthMeters: Double = 0
    @State private var surfaceEndGate = SurfaceEndDiveGate()
    @FocusState private var crownDepthControlFocused: Bool
    private let controlledDepthProvider: DemoDepthSensorProvider?
```

Initialize `controlledDepthProvider` from the same provider passed to `DiveSessionRecorder`.

Use `.onChange(of: recorder.currentDepth)` and a 0.5s timer to call:

```swift
    private func updateSurfaceEndGate(at now: Date = Date()) {
        surfaceEndGate.update(depthMeters: recorder.currentDepth, at: now)
    }
```

Render `End Dive` only when `surfaceEndGate.isVisible`.

- [ ] **Step 7: Implement Crown depth control in RecordingView**

Apply focus and Crown modifier to recording content only when `recordingMode.usesCrownDepthControl`:

```swift
        .focusable(recordingMode.usesCrownDepthControl)
        .focused($crownDepthControlFocused)
        .digitalCrownRotation(
            $controlledDepthMeters,
            from: 0,
            through: 40,
            by: 0.5,
            sensitivity: .medium,
            isContinuous: true,
            isHapticFeedbackEnabled: true
        )
        .onChange(of: controlledDepthMeters) { _, nextDepth in
            controlledDepthProvider?.setDepthMeters(nextDepth)
        }
```

On appear, focus Crown control and set the provider to the current controlled depth for demo/debug.

- [ ] **Step 8: Implement left full-height instrument layout**

In `DepthGaugeRail`, remove fixed height and use parent height:

```swift
        .frame(width: gaugeWidth, maxHeight: .infinity)
```

Create `InstrumentDepthLayout` in `RecordingView.swift`:

```swift
private struct InstrumentDepthLayout<Content: View>: View {
    let depthMeters: Double
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            DepthGaugeRail(
                depthMeters: depthMeters,
                maxScaleMeters: maxScaleMeters,
                stopZone: stopZone,
                targetDepthMeters: targetDepthMeters
            )
            .frame(maxHeight: .infinity)

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
```

Use it in `FreeDiveActiveInstrument`, `ScubaLiveInstrument`, and `SafetyStopInstrument`. Remove mini-card backgrounds from `LiveInstrumentMetric` by deleting the rounded `surfaceContainer` background and keeping text, padding, and stable width.

- [ ] **Step 9: Add debug scheme and Home debug entries**

Create `DiveWatchAppDebug.xcscheme` by copying the existing `DiveWatchApp.xcscheme` and add launch environment:

```xml
      <EnvironmentVariables>
         <EnvironmentVariable
            key = "DIVE_WATCH_DEBUG_CONTROLS"
            value = "1"
            isEnabled = "YES">
         </EnvironmentVariable>
      </EnvironmentVariables>
```

In `HomeView`, define:

```swift
    private var showsDebugControls: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["DIVE_WATCH_DEBUG_CONTROLS"] == "1"
        #else
        false
        #endif
    }
```

Render two debug-only `NavigationLink`s for `Test Freedive` and `Test Scuba` using `recordingMode: .debugTest`.

- [ ] **Step 10: Verify green**

Run the two commands from Step 3.

Expected: PASS.

Run:

```bash
yarn watch:build
```

Expected: PASS. If sandbox fails with Preview macro plugin, rerun with escalation and record the sandbox failure separately.

---

### Task 3: Mobile Cloud Pending Status, Demo Import Reliability, Badge Styling, And Pressure Regression

**Files:**
- Create: `apps/mobile/src/utils/dive-log-sync-status.ts`
- Modify: `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/states/use-dive-logbook.ts`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/components/ui/instrument.tsx`
- Modify: `apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts`
- Modify: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Modify: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Modify: `apps/mobile/__tests__/App.test.tsx`

- [ ] **Step 1: Write failing mapper tests**

In `watch-session-to-dive-log-entry.test.ts`, change the first import status test to:

```ts
  it.each(['pending', 'synced', 'failed'] as const)('marks imported mobile log cloud sync pending while preserving raw watch status %s', syncStatus => {
    const entry = watchSessionToDiveLogEntry({
      session: { ...baseSession, syncStatus },
      now: 1781353000,
    });

    expect(entry.syncStatus).toBe('pending');
    expect(entry.watchCapture?.session.syncStatus).toBe(syncStatus);
  });
```

Update every later expectation in this file that says imported `entry.syncStatus` is `synced` to `pending`.

- [ ] **Step 2: Write failing WatchConnectivity tests**

In `watch-connectivity-sync.test.tsx`, update import expectations:

```ts
    expect(entries[0].syncStatus).toBe('pending');
```

Update `notifyImportedEntry` and `onImportedEntry` assertions to expect `syncStatus: 'pending'`.

Add a duplicate demo import test:

```ts
  it('acknowledges duplicate demo payloads without creating a second log row', async () => {
    const demoFixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        captureMode: 'demo',
        localSessionId: 'demo-duplicate-session',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'demo-duplicate-session',
        })),
      },
    };
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'demo-payload-1',
                payloadJson: JSON.stringify(demoFixture),
                localSessionId: 'demo-duplicate-session',
                receivedAt: 1781357600,
              },
              {
                payloadId: 'demo-payload-2',
                payloadJson: JSON.stringify(demoFixture),
                localSessionId: 'demo-duplicate-session',
                receivedAt: 1781357601,
              },
            ]}
            acknowledgePayloads={jest.fn()}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    const entries = await repository.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].syncStatus).toBe('pending');
    expect(entries[0].watchCapture?.session.captureMode).toBe('demo');
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['demo-payload-1']);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['demo-payload-2']);
  });
```

- [ ] **Step 3: Write failing UI/status tests**

In `logbook-manual-entry.test.tsx`, add a test near the local-only status test:

```ts
  test('shows imported watch rows as pending cloud sync even when stored status is synced', async () => {
    const syncedWatchEntry = {
      ...watchEntry,
      syncStatus: 'synced' as const,
      manual: {
        ...watchEntry.manual,
        site: { name: 'Cloud Pending Reef' },
      },
    };
    const repository = new LocalDiveLogRepository([syncedWatchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    expect(root.findByProps({ testID: 'logbook-list-status-Cloud Pending Reef' }).props.label).toBe('Pending');
  });
```

Add or update a badge style assertion:

```ts
    expect(root.findByProps({ testID: 'logbook-list-status-Cloud Pending Reef' }).props.className).toEqual(
      expect.not.stringContaining('bg-primary text-primary-foreground'),
    );
```

Add imported pressure regression:

```ts
  test('lets an imported scuba log save and display an edited ending pressure', async () => {
    const repository = new LocalDiveLogRepository([watchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Watch Reef');
    await press(root, 'log-entry-detail-edit');
    await changeNumber(root, 'log-entry-editor-pressure-end', 70);
    await press(root, 'log-entry-editor-save');
    await press(root, 'logbook-list-item-Watch Reef');

    const [entry] = await repository.list();
    expect(entry.manual.measuredValues.pressure).toEqual({ unit: 'bar', start: 150, end: 70 });
    expect(root.findByProps({ testID: 'log-entry-detail-mode-value-pressure-150bar->70bar' })).toBeTruthy();
  });
```

In `App.test.tsx`, update imported toast expectations from `synced` to `pending`.

- [ ] **Step 4: Verify red**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/watch-session-to-dive-log-entry.test.ts __tests__/watch-connectivity-sync.test.tsx __tests__/logbook-manual-entry.test.tsx __tests__/App.test.tsx
```

Expected: FAIL because imported logs are still marked `synced`, UI still shows `Synced`, and pill styling still uses filled primary/success colors.

- [ ] **Step 5: Implement sync status helper**

Create `apps/mobile/src/utils/dive-log-sync-status.ts`:

```ts
import type { DiveLogEntry, DiveLogSyncStatus } from '../types/dive-log-entry';

export type VisibleCloudSyncStatus = 'localOnly' | 'synced' | 'pending' | 'failed';

export const getVisibleCloudSyncStatus = (entry: Pick<DiveLogEntry, 'syncStatus'>): VisibleCloudSyncStatus => {
  if (entry.syncStatus === 'localOnly') {
    return 'localOnly';
  }

  return 'pending';
};

export const toMobileSessionSyncStatus = (syncStatus: DiveLogSyncStatus) => {
  if (syncStatus === 'localOnly') {
    return undefined;
  }

  return syncStatus === 'synced' ? 'pending' : syncStatus;
};
```

- [ ] **Step 6: Use pending for imported watch logs**

In `watch-session-to-dive-log-entry.ts`, change:

```ts
    syncStatus: 'synced',
```

to:

```ts
    syncStatus: 'pending',
```

In `watch-connectivity-sync.tsx`, rename `markWatchConnectivityImportSynced` to `markWatchConnectivityImported` and save:

```ts
  const savedEntry = await repository.save({
    ...enrichedEntry,
    syncStatus: 'pending',
    updatedAt: payload.receivedAt ?? Date.now() / 1000,
  });
```

Keep acknowledgement behavior unchanged.

- [ ] **Step 7: Use visible cloud status in list and home**

In `logbook/screen.tsx`, import `getVisibleCloudSyncStatus`, remove the local `toVisibleSyncStatus`, and compute:

```ts
return props.entries.filter(entry => getVisibleCloudSyncStatus(entry) === syncFilter);
```

In `SessionListItem`:

```ts
const status = getVisibleCloudSyncStatus(props.entry);
```

In `home/screen.tsx`, use `toMobileSessionSyncStatus` or equivalent pending mapping so latest watch import does not show `Synced` from local import.

In `use-dive-logbook.ts`, replace `toWatchSyncStatus` with the shared helper and preserve the return type:

```ts
const toWatchSyncStatus = (syncStatus: DiveLogSyncStatus): MobileDiveSession['syncStatus'] => {
  return toMobileSessionSyncStatus(syncStatus);
};
```

- [ ] **Step 8: Restyle StatusPill**

In `instrument.tsx`, make all status tones low-chroma:

```ts
const pillStyles = tva({
  base: 'self-start overflow-hidden rounded-full border px-3 py-1 text-xs font-semibold uppercase',
  variants: {
    tone: {
      primary: 'border-primary/20 bg-primary/10 text-primary',
      secondary: 'border-secondary/30 bg-secondary/70 text-secondary-foreground',
      success: 'border-primary/20 bg-primary/10 text-primary',
      warning: 'border-primary/20 bg-secondary/70 text-primary',
      danger: 'border-destructive/20 bg-destructive/10 text-destructive',
      muted: 'border-border bg-muted text-muted-foreground',
    },
  },
  defaultVariants: {
    tone: 'primary',
  },
});
```

Keep `InstrumentButton` styling unchanged so badges no longer resemble primary CTAs.

- [ ] **Step 9: Verify green**

Run the same Jest command from Step 4.

Expected: PASS.

Run:

```bash
yarn mobile:typecheck
```

Expected: PASS.

---

### Task 4: Wiki Updates For Durable Architecture, Sync, And Safety Knowledge

**Files:**
- Create: `.wiki/raw/decisions/2026-07-07-watch-debug-demo-sync-logbook-ux.md`
- Modify: `.wiki/wiki/architecture/watch-app.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/domains/dive-log.md`
- Modify: `.wiki/wiki/domains/safety-rules.md`
- Modify: `.wiki/wiki/questions/open-questions.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

- [ ] **Step 1: Capture immutable raw source**

Create `.wiki/raw/decisions/2026-07-07-watch-debug-demo-sync-logbook-ux.md`:

```md
# Watch debug demo sync logbook UX decision

Source URL: Local user decision and implementation in `docs/superpowers/specs/2026-07-07-watch-debug-demo-sync-logbook-ux-design.md`
Collected: 2026-07-07
Published: 2026-07-07

## 원문 요약

사용자는 watch 앱의 Debug scheme에서 프리다이빙과 스쿠버 테스트 세션을 모두 시작할 수 있어야 한다고 결정했다. 사용자 Demo와 개발 테스트는 일반 저장, summary, sync, mobile import 경로를 통과한다.

모바일 로그북의 `동기화됨`은 미래 cloud sync 성공 상태로 예약한다. 현재 cloud sync backend가 없으므로 watch에서 mobile로 import된 로그도 cloud sync 배지는 `대기 중`으로 표시한다. Watch import acknowledgement는 watch local transfer 상태로만 다룬다.

워치 기록 화면은 카드뷰를 피하고 좌측 full-height 수심계와 우측 live values 구조를 사용한다. Demo와 Debug 테스트 중에는 Digital Crown으로 수심을 조절하고 수온은 자동 생성한다. 다이브 종료 버튼은 1.0m 이하에서 3초 이상 안정될 때만 표시하고 1.2m 이상으로 돌아가면 숨긴다.

스쿠버 safety stop reminder는 10m arm, 5m target, 3-6m display zone, 2.7-6.3m counting zone, 180초 duration을 유지한다. Counting zone 밖에 연속 30초 이상 머무르면 timer를 180초부터 다시 시작한다. Too-deep 상태에서는 세이프티 스톱 전용 화면에서 벗어나 일반 scuba live 화면을 보여준다.

압력 metadata는 시작/종료 압력을 모두 표현할 수 있지만, watch-imported scuba log는 tank pressure sensor가 없으므로 종료 압력을 자동 생성하지 않는다.

## Safety boundary

이 결정은 logging, demo/test, UI routing, cloud-status vocabulary, non-critical reminder 정책이다. 감압 의무, NDL, tissue loading, gas remaining, emergency instruction, certified dive-computer replacement를 계산하거나 주장하지 않는다.
```

- [ ] **Step 2: Update compiled articles**

Update the smallest relevant sections:

- `architecture/watch-app.md`: add `DiveWatchAppDebug` same-target scheme, Demo/Debug Crown-controlled depth, left full-height gauge, surface-gated end button, and safety-stop too-deep routing/reset policy.
- `architecture/sync-flow.md`: separate watch import acknowledgement from future cloud sync; mobile logbook cloud badge remains pending while cloud is absent.
- `domains/dive-log.md`: pressure start/end metadata support and no automatic end-pressure inference from watch imports.
- `domains/safety-rules.md`: 30s safety-stop timer reset is a reminder policy, not a decompression calculation.
- `questions/open-questions.md`: remove ambiguity that cloud sync exists now if present; keep real-device validation and future cloud sync implementation as open items.

Each touched article must set `Updated: 2026-07-07`.

- [ ] **Step 3: Update index and log**

Refresh `.wiki/wiki/index.md` rows for every touched compiled article with updated summaries where needed and `Updated` date `2026-07-07`.

Append to `.wiki/wiki/log.md`:

```md
## [2026-07-07] ingest | Watch debug demo sync logbook UX
- Added: Watch debug demo sync logbook UX raw source
- Updated: Watch 앱 구조
- Updated: 동기화 흐름 구조
- Updated: 다이브 로그 도메인
- Updated: 안전 규칙
- Updated: 열린 질문
- Updated: Knowledge Base Index
```

- [ ] **Step 4: Verify wiki strings**

Run:

```bash
rg -n "safe to ascend|상승 가능|이제 안전합니다|감압 완료|certified dive computer replacement" .wiki/wiki .wiki/raw/decisions/2026-07-07-watch-debug-demo-sync-logbook-ux.md
```

Expected: only existing safety-rule guard text or negative examples; no new claim that the app is certified or safety-critical.

---

## Final Verification

After all tasks and reviewer fixes:

1. Run focused mobile tests:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/watch-session-to-dive-log-entry.test.ts __tests__/watch-connectivity-sync.test.tsx __tests__/logbook-manual-entry.test.tsx __tests__/App.test.tsx __tests__/watch-connectivity-native-source.test.ts
```

2. Run watch XCTest focused tests:

```bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test -only-testing:DiveWatchAppTests/SafetyStopControllerTests -only-testing:DiveWatchAppTests/SurfaceEndDiveGateTests -only-testing:DiveWatchAppTests/WatchRecordingModeTests
```

3. Run required gates:

```bash
yarn mobile:typecheck
yarn watch:build
yarn codex:check
```

If `yarn watch:build` fails inside sandbox with the SwiftUI Preview macro plugin error, rerun with escalation and report both results.

4. Inspect diff:

```bash
git status --short
git diff --stat
git diff --check
```

5. Commit all verified changes from the feature worktree:

```bash
git add docs/superpowers/plans/2026-07-07-watch-debug-demo-sync-logbook-ux.md apps/mobile .wiki
git commit -m "feat: improve watch debug demo sync logbook ux"
```
