# Watch Live Ascent Rate Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Watch recorder's adjacent-callback ascent-rate spikes with a deterministic 3-5 second net-depth estimator for the live display and transient warning only.

**Architecture:** A pure value type, `DisplayAscentRateEstimator`, owns a bounded recent sample window and returns a finite meters-per-minute display value. `DiveSessionRecorder` resets and feeds that estimator from valid raw callbacks. Raw callbacks, one-hertz profile sampling, sync artifacts, and historical `ScubaDiveEngine` fields remain untouched.

**Tech Stack:** Xcode 26.6 Swift compiler in the existing Swift 5 language mode (`SWIFT_VERSION = 5.0`), Foundation, Combine, XCTest, existing watchOS 10+ Watch app/test targets.

## Global Constraints

- The displayed ascent value is a non-certified reference. It does not grant ascent permission, calculate decompression status, or replace training or a certified dive computer.
- Do not change `DepthSample`, JSON contracts, generated Swift/TypeScript, WatchConnectivity payloads, one-hertz profile cadence, stored samples, or schema versions.
- Do not change `ScubaDiveEngine` ascent fields in this pass; they are historical payload behavior, not the live UI source being fixed.
- Use at most 5 seconds of valid raw samples, require at least 3 seconds between the oldest and newest usable sample, and ignore net upward changes of `0.15m` or less.
- Compute one net depth decrease across the window. Do not sum adjacent positive movements and do not average instantaneous rates.
- Invalid, non-finite, duplicate-timestamp, or out-of-order input returns `0` and does not corrupt the retained valid window.
- Keep the existing `9m/min` transient reference threshold, but feed it from the smoothed display value.
- Reset estimator state at every recorder start and cancellation so separate sessions cannot share samples.
- Preserve unrelated worktree changes and use the existing Xcode/Yarn toolchain.

## File Structure

- Create `apps/mobile/ios/DivenaryWatchApp/Recording/DisplayAscentRateEstimator.swift`: pure bounded-window estimator.
- Create `apps/mobile/ios/DivenaryWatchAppTests/DisplayAscentRateEstimatorTests.swift`: deterministic estimator unit tests.
- Create `apps/mobile/ios/DivenaryWatchAppTests/DiveSessionRecorderAscentRateTests.swift`: raw-callback integration and persistence-regression tests.
- Modify `apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift`: replace adjacent-callback display calculation and reset estimator lifecycle.
- Modify `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`: add new production/test files to their exact targets.
- Create `.wiki/raw/architecture/2026-07-18-watch-live-ascent-rate-smoothing.md`.
- Modify `.wiki/wiki/architecture/watch-app.md`, `.wiki/wiki/index.md`, and `.wiki/wiki/log.md` with the durable live-versus-persisted calculation boundary.

---

### Task 1: Implement the bounded display estimator with TDD

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Recording/DisplayAscentRateEstimator.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/DisplayAscentRateEstimatorTests.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interface:**

```swift
struct DisplayAscentRateEstimator {
    init(
        minimumWindowDuration: TimeInterval = 3,
        maximumWindowDuration: TimeInterval = 5,
        depthDeadbandMeters: Double = 0.15
    )

    mutating func append(_ sample: DepthSample) -> Double
    mutating func reset()
}
```

**Calculation:**

```swift
let elapsed = newest.timestamp.timeIntervalSince(oldest.timestamp)
let netDepthDecrease = oldest.depthMeters - newest.depthMeters

guard elapsed >= 3, netDepthDecrease > 0.15 else { return 0 }
let rate = netDepthDecrease / elapsed * 60
return rate.isFinite && rate > 0 ? rate : 0
```

Before calculating, remove retained samples with timestamps earlier than `newest.timestamp - 5s`. The oldest remaining sample is the window start. A sample is usable only when `sample.isValidRecordingSample`, its timestamp interval is finite, and its timestamp is strictly later than the last retained sample.

- [ ] **Step 1: Add failing window and jitter tests**

Cover:

- first sample returns `0`,
- positive movement before a 3-second span returns `0`,
- `12.0m -> 10.5m` over exactly 3 seconds returns `30m/min`,
- exactly `0.15m` and smaller net movement returns `0`,
- `0.1501m` over a qualifying span returns a finite positive value,
- flat and deeper newest samples return `0`,
- oscillation with no net upward change returns `0` even when adjacent callbacks include upward moves,
- samples older than 5 seconds are pruned and the new oldest point drives the calculation,
- invalid depth/pressure/temperature, non-finite date interval, duplicate timestamp, and out-of-order timestamp return `0` without mutating the valid window,
- a valid sequence after rejected input recovers to the expected rate,
- `reset()` removes all retained history.

```swift
func testJitterDoesNotBecomeAnAscentRate() {
    var estimator = DisplayAscentRateEstimator()
    XCTAssertEqual(estimator.append(sample(at: 0, depth: 10.00)), 0)
    XCTAssertEqual(estimator.append(sample(at: 1, depth: 9.94)), 0)
    XCTAssertEqual(estimator.append(sample(at: 2, depth: 10.03)), 0)
    XCTAssertEqual(estimator.append(sample(at: 3, depth: 9.90)), 0)
}
```

- [ ] **Step 2: Add the files to project membership and prove failure**

Add the estimator to `DivenaryWatchApp` Sources and the test to `DivenaryWatchAppTests` Sources, then run:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/DisplayAscentRateEstimatorTests test
```

Expected: FAIL because `DisplayAscentRateEstimator` is not implemented.

- [ ] **Step 3: Implement the minimum estimator**

Use a private `[DepthSample]` buffer. Validate constructor invariants with preconditions: minimum window is positive, maximum window is at least the minimum, and deadband is non-negative. Keep pruning and validation in small private methods; do not introduce timers, publishers, sensor ownership, or persistence.

```swift
mutating func append(_ sample: DepthSample) -> Double {
    guard isUsable(sample), isStrictlyNewer(sample) else { return 0 }
    samples.append(sample)
    prune(relativeTo: sample.timestamp)
    guard let oldest = samples.first else { return 0 }
    return rate(from: oldest, to: sample)
}
```

- [ ] **Step 4: Pass focused tests**

Run the command from Step 2.

Expected: every estimator case passes with exact finite results.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Recording/DisplayAscentRateEstimator.swift apps/mobile/ios/DivenaryWatchAppTests/DisplayAscentRateEstimatorTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: add watch ascent display estimator"
```

### Task 2: Integrate smoothing into live recorder state

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchAppTests/DiveSessionRecorderAscentRateTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Recorder changes:**

```swift
private var displayAscentRateEstimator = DisplayAscentRateEstimator()
```

In `append(_:)`:

```swift
latestAscentRateMetersPerMinute = displayAscentRateEstimator.append(sample)
ascentWarningActive = latestAscentRateMetersPerMinute > recommendedAscentRateMetersPerMinute
```

Delete only `DiveSessionRecorder.ascentRate(from:to:)`. Leave `ScubaDiveEngine.ascentRate(from:to:)` unchanged.

- [ ] **Step 1: Add failing recorder integration tests**

Use a manual sensor provider and in-memory `DiveProfileRecordingStoring` stub. Emit raw callbacks and `await Task.yield()` after each batch because the recorder dispatches sample handling onto `MainActor`.

Cover:

- rapid `0.1m` callback jitter never creates a live rate or warning,
- a qualifying 3-second net ascent updates `latestAscentRateMetersPerMinute`,
- a `<=9m/min` smoothed result leaves `ascentWarningActive == false`,
- a `>9m/min` smoothed result sets the existing transient flag,
- a flat/deeper qualifying window returns live state to `0` and clears the flag,
- cancel then restart requires a fresh 3-second window,
- invalid/out-of-order callbacks do not poison later valid display values,
- multiple raw callbacks in one second still produce the existing one-hertz persisted sample count and extrema,
- stopping a scuba session keeps `ScubaDiveSession.latestAscentRateMetersPerMinute` and `maxAscentRateMetersPerMinute` governed by the unchanged engine path.

```swift
@MainActor
func testRecorderUsesNetWindowForLiveAscentOnly() async {
    recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
    sensor.emit(sample(at: 0, depth: 12.0))
    sensor.emit(sample(at: 1, depth: 11.9))
    sensor.emit(sample(at: 2, depth: 11.4))
    sensor.emit(sample(at: 3, depth: 11.4))
    await Task.yield()

    XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 12, accuracy: 0.001)
    XCTAssertTrue(recorder.ascentWarningActive)
}
```

- [ ] **Step 2: Prove recorder tests fail against the adjacent-sample calculation**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/DiveSessionRecorderAscentRateTests test
```

Expected: FAIL because the current recorder reports adjacent-callback spikes and zeroes instead of the 3-second net value.

- [ ] **Step 3: Reset estimator at session boundaries**

Call `displayAscentRateEstimator.reset()` in `startSession` before accepting samples and in `cancelSession`. Continue resetting the published live rate and warning fields as today. Do not move the estimator into the sensor provider or `ScubaDiveEngine`.

- [ ] **Step 4: Replace only the live calculation**

Remove `lastRawSample` from the live-rate calculation but retain it for `hasCapturedDepthSample` and end timestamp behavior. Feed every accepted raw sample to the estimator before the one-hertz sampler and mode engine. Keep warning comparison strict (`> 9`, not `>= 9`).

- [ ] **Step 5: Pass focused and existing profile/engine tests**

Run the focused command from Step 2, then:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData -only-testing:DivenaryWatchAppTests/DiveSessionRecordMigrationTests -only-testing:DivenaryWatchAppTests/ScubaDiveEngineTests test
```

Expected: recorder smoothing tests pass; one-hertz persistence and engine payload regressions remain green.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift apps/mobile/ios/DivenaryWatchAppTests/DiveSessionRecorderAscentRateTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "fix: smooth watch live ascent rate"
```

### Task 3: Verify UI behavior and record the calculation boundary

**Files:**
- Create: `.wiki/raw/architecture/2026-07-18-watch-live-ascent-rate-smoothing.md`
- Modify: `.wiki/wiki/architecture/watch-app.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

- [ ] **Step 1: Inspect the live UI with deterministic demo depth**

Use Demo or debug-test mode on 42mm, 46mm, and 49mm simulators. Hold a steady depth with small Crown changes, then perform a gradual multi-second ascent. Verify the `Ascent` metric stays `0` during the first 3 seconds and for `<=0.15m` net jitter, then changes at the expected windowed rate without rapid per-callback spike/zero flashing. Confirm no metric changes the instrument layout size.

- [ ] **Step 2: Write the immutable wiki source**

Follow `karpathy-llm-wiki` and `wiki-writing`. Record:

- the old adjacent-callback formula and why it amplified roughly three callbacks per second,
- the exact 3-second minimum, 5-second maximum, and `0.15m` deadband,
- the net-change formula,
- the boundary that only live display and transient warning changed,
- the unchanged raw callbacks, one-hertz artifacts, sync schema, and `ScubaDiveEngine` historical fields,
- the non-certified safety wording.

Add a concise live-ascent estimator section to the compiled Watch architecture page. Add raw/compiled links to wiki index/log according to repository conventions.

- [ ] **Step 3: Run final automated gates**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData test
yarn watch:build
yarn codex:check
```

Expected: full Watch tests, Watch build, and repository handoff checks pass. Record the exact XCTest count and any environment warnings separately from failures.

- [ ] **Step 4: Commit**

```bash
git add .wiki
git commit -m "docs: record watch ascent smoothing boundary"
```

## Completion Gate

- Live ascent stays `0` before a 3-second usable span and for net upward movement `<=0.15m`.
- The estimator retains no sample older than 5 seconds relative to its newest accepted sample.
- Invalid and out-of-order input returns `0` without corrupting later valid calculations.
- `DiveSessionRecorder.latestAscentRateMetersPerMinute` and `ascentWarningActive` use the estimator.
- `ScubaDiveEngine`, one-hertz persisted profile samples, sync contracts, and schema versions are unchanged.
- Separate sessions cannot share estimator history.
- Full Watch tests, `yarn watch:build`, and `yarn codex:check` pass with exact results recorded.
