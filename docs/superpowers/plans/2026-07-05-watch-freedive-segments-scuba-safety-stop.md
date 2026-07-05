# Watch Freedive Segments And Scuba Safety Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build multi-segment freedive sessions, rule-based scuba safety stop reminders, mode-aware watch sync payloads, and matching watch/mobile review UI without making certified dive computer claims.

**Architecture:** Use a common session shell with mode-specific core payloads. Swift engines own state transitions; SwiftUI renders snapshots. The watch sync contract and mobile import path become mode-aware while old local logs are adapted instead of reset.

**Tech Stack:** watchOS SwiftUI, Swift Codable, XCTest, Xcode project target editing, JSON Schema, generated Swift/TypeScript contracts, React Native TypeScript, Jest, Yarn 1.

---

## File Structure

Create:

- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
  - Common watch session shell, `DiveSessionPayload`, `FreeDiveSession`, `FreeDiveSegment`, `ScubaDiveSession`, `SafetyStopRecord`, migration helpers from old `DiveSession`.
- `apps/mobile/ios/DiveWatchApp/Recording/FreeDiveSessionEngine.swift`
  - Pure Swift freedive segmentation state machine.
- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
  - Pure Swift safety stop timer and status state machine.
- `apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift`
  - Pure Swift scuba engine using `SafetyStopController`.
- `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
  - Deep Blue Minimal Scale depth gauge with safety stop zone overlay.
- `apps/mobile/ios/DiveWatchAppTests/EngineTestFixtures.swift`
  - Deterministic sample builders and date helpers.
- `apps/mobile/ios/DiveWatchAppTests/FreeDiveSessionEngineTests.swift`
- `apps/mobile/ios/DiveWatchAppTests/SafetyStopControllerTests.swift`
- `apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift`
- `apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift`
- `packages/contracts/fixtures/freedive-multi-segment-watch-sync-message.json`
- `packages/contracts/fixtures/scuba-safety-stop-watch-sync-message.json`

Modify:

- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
  - Delegate mode logic to engines and return `DiveSessionRecord`.
- `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
  - Store `[DiveSessionRecord]`, migrate old `[DiveSession]`.
- `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
  - Keep legacy model decodeable until migration is complete.
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift`
  - Add record-based summary helpers while preserving old sample fallback during migration.
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
  - Launchpad layout and Korean-first start copy.
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
  - Mode-specific full-screen instrument surfaces.
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
  - Mode-aware summary.
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
  - Mode-aware saved-log detail.
- `apps/mobile/ios/DiveWatchApp/Views/DiveFormatters.swift`
  - Formatting for segment labels, surface interval, and safety stop status.
- `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`
  - Add English source strings and Korean translations.
- `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - Add `DiveWatchAppTests` target and include new watch source/test files.
- `packages/contracts/schemas/watch-session.schema.json`
  - Mode-aware schema with nested `freedive` and `scuba` payloads.
- `packages/contracts/fixtures/minimal-watch-sync-message.json`
  - Update to valid new minimal scuba message.
- `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`
  - Update to valid new richer message.
- `packages/contracts/generated/typescript/index.ts`
  - Regenerated only.
- `packages/contracts/generated/swift/WatchContracts.swift`
  - Regenerated only.
- `apps/mobile/src/utils/watch-sync-message-validation.ts`
  - Mode-aware runtime validator.
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
  - Preserve mode-specific metadata.
- `apps/mobile/src/utils/session-summary.ts`
  - Use new mode payload summaries with sample fallbacks.
- `apps/mobile/src/types/dive-session.ts`
  - Re-export generated mode-aware contract types.
- `apps/mobile/src/types/dive-log-entry.ts`
  - Add watch-capture mode-specific metadata if not already covered by generated types.
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
  - Render freedive segment and scuba safety stop sections.
- `apps/mobile/src/i18n/resources.ts`
  - Korean and English mobile strings for new detail sections.
- `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
  - Source scans for engines, test target, and banned copy.
- Add or modify focused Jest tests for validator/import/detail behavior.

Do not modify generated contract files by hand.

---

### Task 1: Add Watch XCTest Target Skeleton

**Files:**
- Create: `apps/mobile/ios/DiveWatchAppTests/EngineTestFixtures.swift`
- Create: `apps/mobile/ios/DiveWatchAppTests/FreeDiveSessionEngineTests.swift`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`

- [ ] **Step 1: Create a minimal fixture file**

```swift
import Foundation

enum EngineTestFixtures {
    static let start = Date(timeIntervalSince1970: 1_783_225_525)

    static func date(_ secondsAfterStart: TimeInterval) -> Date {
        start.addingTimeInterval(secondsAfterStart)
    }

    static func sample(
        _ secondsAfterStart: TimeInterval,
        depth: Double,
        temperature: Double = 24
    ) -> DepthSample {
        DepthSample(
            timestamp: date(secondsAfterStart),
            depthMeters: depth,
            pressureKPa: 101.325 + depth * 9.80665,
            waterTemperatureCelsius: temperature
        )
    }
}
```

- [ ] **Step 2: Create a smoke XCTest that intentionally references the future engine**

```swift
import XCTest
@testable import DiveWatchApp

final class FreeDiveSessionEngineTests: XCTestCase {
    func testStartingSessionCreatesNoSegmentUntilMeaningfulDescent() {
        let engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)
        XCTAssertNil(engine.snapshot.activeSegment)
    }
}
```

- [ ] **Step 3: Add `DiveWatchAppTests` to the Xcode project**

Edit `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj` so `xcodebuild -list -project ios/DiveMobile.xcodeproj` shows:

```text
Targets:
    DiveMobile
    DiveWatchApp
    DiveWatchAppTests
```

The test target must:

- Use `com.apple.product-type.bundle.unit-test`.
- Depend on `DiveWatchApp`.
- Include `EngineTestFixtures.swift` and test files in its Sources build phase.
- Use watchOS simulator SDK settings compatible with the existing `DiveWatchApp` target.
- Set `TEST_HOST` empty and `BUNDLE_LOADER` empty for pure unit tests.

- [ ] **Step 4: Run the test target and verify it fails for missing engine**

Run from `apps/mobile`:

```bash
xcodebuild -project ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' -derivedDataPath /private/tmp/DiveWatchAppTestsDerivedData CODE_SIGNING_ALLOWED=NO test
```

Expected: build fails because `FreeDiveSessionEngine` is not defined.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DiveWatchAppTests apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "test: add watch engine test target"
```

---

### Task 2: Add Mode-Specific Session Models And Legacy Adapter

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- Test: `apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift`

- [ ] **Step 1: Write migration tests**

```swift
import XCTest
@testable import DiveWatchApp

final class DiveSessionRecordMigrationTests: XCTestCase {
    func testOldFreediveSessionAdaptsToOneSegment() {
        let samples = [
            EngineTestFixtures.sample(0, depth: 0),
            EngineTestFixtures.sample(4, depth: 12),
            EngineTestFixtures.sample(20, depth: 0.4)
        ]
        let old = DiveSession(
            diveMode: .freedive,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(20),
            samples: samples
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .freedive(session) = record.payload else {
            return XCTFail("Expected freedive payload")
        }
        XCTAssertEqual(session.diveCount, 1)
        XCTAssertEqual(session.segments.count, 1)
        XCTAssertEqual(session.maxDepthMeters, 12)
    }

    func testOldScubaSessionAdaptsWithUnknownSafetyStop() {
        let old = DiveSession(
            diveMode: .scuba,
            gasLabel: "Air",
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(1200),
            samples: [
                EngineTestFixtures.sample(0, depth: 0),
                EngineTestFixtures.sample(60, depth: 21.2),
                EngineTestFixtures.sample(1200, depth: 0)
            ]
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .scuba(session) = record.payload else {
            return XCTFail("Expected scuba payload")
        }
        XCTAssertEqual(session.gasLabel, "Air")
        XCTAssertEqual(session.safetyStop.status, .unknown)
    }
}
```

- [ ] **Step 2: Run tests and verify failure**

Run the `DiveWatchAppTests` command from Task 1.

Expected: fails because `DiveSessionRecord` and payload types are missing.

- [ ] **Step 3: Implement session record models**

```swift
import Foundation

struct DiveSessionRecord: Codable, Identifiable {
    let id: UUID
    let schemaVersion: Int
    let diveMode: DiveMode
    let siteId: String?
    let siteName: String?
    let sourcePlanLocalId: String?
    let planTitle: String?
    let buddyIds: [String]
    let gearIds: [String]
    let tags: [String]
    let notes: String?
    let rating: Int?
    let perceivedExertion: Int?
    let visibilityRating: Int?
    let waterCondition: WaterCondition
    let syncStatus: DiveSyncStatus
    let entryLocation: WatchLocation?
    let exitLocation: WatchLocation?
    let startedAt: Date
    let endedAt: Date?
    let samples: [DepthSample]
    let payload: DiveSessionPayload
}

enum DiveSessionPayload: Codable {
    case freedive(FreeDiveSession)
    case scuba(ScubaDiveSession)

    private enum CodingKeys: String, CodingKey {
        case type
        case freedive
        case scuba
    }

    private enum PayloadType: String, Codable {
        case freedive
        case scuba
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(PayloadType.self, forKey: .type)
        switch type {
        case .freedive:
            self = .freedive(try container.decode(FreeDiveSession.self, forKey: .freedive))
        case .scuba:
            self = .scuba(try container.decode(ScubaDiveSession.self, forKey: .scuba))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .freedive(let session):
            try container.encode(PayloadType.freedive, forKey: .type)
            try container.encode(session, forKey: .freedive)
        case .scuba(let session):
            try container.encode(PayloadType.scuba, forKey: .type)
            try container.encode(session, forKey: .scuba)
        }
    }
}

struct FreeDiveSession: Codable, Equatable {
    let id: UUID
    let startTime: Date
    let endTime: Date?
    let totalDurationSeconds: TimeInterval
    let maxDepthMeters: Double
    let diveCount: Int
    let longestDiveDurationSeconds: TimeInterval
    let segments: [FreeDiveSegment]
}

struct FreeDiveSegment: Codable, Identifiable, Equatable {
    let id: UUID
    let index: Int
    let startTime: Date
    let endTime: Date?
    let durationSeconds: TimeInterval
    let maxDepthMeters: Double
    let minDepthMeters: Double
    let sampleStartIndex: Int
    let sampleEndIndex: Int
    let descentRateMetersPerSecond: Double?
    let ascentRateMetersPerSecond: Double?
}

struct ScubaDiveSession: Codable, Equatable {
    let id: UUID
    let startTime: Date
    let endTime: Date?
    let durationSeconds: TimeInterval
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let waterTemperatureCelsius: Double?
    let gasLabel: String?
    let latestAscentRateMetersPerMinute: Double
    let maxAscentRateMetersPerMinute: Double
    let safetyStop: SafetyStopRecord
}

struct SafetyStopRecord: Codable, Equatable {
    let status: SafetyStopStatus
    let required: Bool
    let completed: Bool
    let targetDepthMeters: Double
    let minDepthMeters: Double
    let maxDepthMeters: Double
    let durationSeconds: TimeInterval
    let startedAt: Date?
    let completedAt: Date?
    let remainingSeconds: TimeInterval
    let timeInZoneSeconds: TimeInterval

    static let legacyUnknown = SafetyStopRecord(
        status: .unknown,
        required: false,
        completed: false,
        targetDepthMeters: 5,
        minDepthMeters: 3,
        maxDepthMeters: 6,
        durationSeconds: 180,
        startedAt: nil,
        completedAt: nil,
        remainingSeconds: 180,
        timeInZoneSeconds: 0
    )
}

enum SafetyStopStatus: String, Codable, Equatable {
    case unknown
    case notRequired
    case armed
    case active
    case pausedTooDeep
    case pausedTooShallow
    case completed
    case skippedOrIncomplete
}
```

- [ ] **Step 4: Add legacy adapter extension**

```swift
extension DiveSessionRecord {
    init(legacySession session: DiveSession) {
        let summary = session.summary
        let payload: DiveSessionPayload

        switch session.diveMode {
        case .freedive:
            let segment = FreeDiveSegment(
                id: UUID(),
                index: 1,
                startTime: session.startedAt,
                endTime: session.endedAt,
                durationSeconds: summary.durationSeconds,
                maxDepthMeters: summary.maxDepthMeters,
                minDepthMeters: session.samples.map(\.depthMeters).min() ?? 0,
                sampleStartIndex: session.samples.isEmpty ? 0 : 0,
                sampleEndIndex: max(0, session.samples.count - 1),
                descentRateMetersPerSecond: nil,
                ascentRateMetersPerSecond: nil
            )
            payload = .freedive(
                FreeDiveSession(
                    id: session.id,
                    startTime: session.startedAt,
                    endTime: session.endedAt,
                    totalDurationSeconds: summary.durationSeconds,
                    maxDepthMeters: summary.maxDepthMeters,
                    diveCount: session.samples.isEmpty ? 0 : 1,
                    longestDiveDurationSeconds: summary.durationSeconds,
                    segments: session.samples.isEmpty ? [] : [segment]
                )
            )
        case .scuba:
            payload = .scuba(
                ScubaDiveSession(
                    id: session.id,
                    startTime: session.startedAt,
                    endTime: session.endedAt,
                    durationSeconds: summary.durationSeconds,
                    maxDepthMeters: summary.maxDepthMeters,
                    averageDepthMeters: summary.averageDepthMeters,
                    waterTemperatureCelsius: summary.averageWaterTemperatureCelsius,
                    gasLabel: session.gasLabel,
                    latestAscentRateMetersPerMinute: summary.latestAscentRateMetersPerMinute,
                    maxAscentRateMetersPerMinute: summary.maxAscentRateMetersPerMinute,
                    safetyStop: .legacyUnknown
                )
            )
        }

        self.init(
            id: session.id,
            schemaVersion: 2,
            diveMode: session.diveMode,
            siteId: session.siteId,
            siteName: session.siteName,
            sourcePlanLocalId: session.sourcePlanLocalId,
            planTitle: session.planTitle,
            buddyIds: session.buddyIds,
            gearIds: session.gearIds,
            tags: session.tags,
            notes: session.notes,
            rating: session.rating,
            perceivedExertion: session.perceivedExertion,
            visibilityRating: session.visibilityRating,
            waterCondition: session.waterCondition,
            syncStatus: session.syncStatus,
            entryLocation: session.entryLocation,
            exitLocation: session.exitLocation,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            samples: session.samples,
            payload: payload
        )
    }
}
```

- [ ] **Step 5: Run tests and verify migration tests pass**

Run the `DiveWatchAppTests` command from Task 1.

Expected: migration tests pass; FreeDive engine smoke test still fails until Task 3.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: add mode-specific watch session records"
```

---

### Task 3: Implement Freedive Segmentation Engine

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Recording/FreeDiveSessionEngine.swift`
- Modify: `apps/mobile/ios/DiveWatchAppTests/FreeDiveSessionEngineTests.swift`

- [ ] **Step 1: Replace smoke test with full freedive state tests**

```swift
import XCTest
@testable import DiveWatchApp

final class FreeDiveSessionEngineTests: XCTestCase {
    func testStartingSessionCreatesNoSegmentUntilMeaningfulDescent() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        engine.append(EngineTestFixtures.sample(0, depth: 0.2))
        engine.append(EngineTestFixtures.sample(1, depth: 0.6))
        engine.append(EngineTestFixtures.sample(2, depth: 0.7))

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)
    }

    func testSustainedDescentStartsDiveOne() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        [0.2, 1.3, 1.6, 2.1, 2.8].enumerated().forEach { offset, depth in
            engine.append(EngineTestFixtures.sample(TimeInterval(offset), depth: depth))
        }

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.activeSegment?.index, 1)
    }

    func testReturningToSurfaceClosesDiveOne() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0,0.1),(1,1.3),(2,2.0),(3,5.0),(10,0.7),(14,0.5)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.state, .surfaceInterval)
        XCTAssertEqual(engine.snapshot.segments.count, 1)
        XCTAssertEqual(engine.snapshot.segments[0].index, 1)
    }

    func testSecondDescentCreatesDiveTwoInSameSession() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0,0.1),(1,1.3),(2,2.0),(3,5.0),(10,0.7),(14,0.5),(20,1.4),(21,2.5),(23,8.0)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.segments.count, 1)
        XCTAssertEqual(engine.snapshot.activeSegment?.index, 2)
    }

    func testSurfaceIntervalTimerUsesPreviousSegmentEnd() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0,0.1),(1,1.3),(2,2.0),(3,5.0),(10,0.7),(14,0.5)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.surfaceInterval(at: EngineTestFixtures.date(44)), 30)
    }

    func testShallowNoiseDoesNotCreateFakeDive() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for second in 0...20 {
            let depth = second.isMultiple(of: 2) ? 0.9 : 1.05
            engine.append(EngineTestFixtures.sample(TimeInterval(second), depth: depth))
        }

        XCTAssertEqual(engine.snapshot.diveCount, 0)
        XCTAssertEqual(engine.state, .surfaceReady)
    }

    func testManualEndFinalizesOpenSegment() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0,0.1),(1,1.3),(2,2.0),(3,5.0)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        let session = engine.finish(at: EngineTestFixtures.date(9))

        XCTAssertEqual(session.diveCount, 1)
        XCTAssertEqual(session.segments[0].endTime, EngineTestFixtures.date(9))
    }
}
```

- [ ] **Step 2: Run tests and verify failure**

Run the `DiveWatchAppTests` command from Task 1.

Expected: fails because `FreeDiveSessionEngine` is missing.

- [ ] **Step 3: Implement the engine**

```swift
import Foundation

struct FreeDiveSegmentationConfiguration: Equatable {
    var diveStartDepthThreshold: Double = 1.2
    var surfaceDepthThreshold: Double = 0.8
    var sustainedDescentDuration: TimeInterval = 3
    var surfaceConfirmDuration: TimeInterval = 4
}

enum FreeDiveSessionState: Equatable {
    case surfaceReady
    case diveActive
    case surfaceInterval
    case summary
}

struct FreeDiveSessionSnapshot: Equatable {
    var state: FreeDiveSessionState
    var segments: [FreeDiveSegment]
    var activeSegment: FreeDiveSegment?
    var diveCount: Int
    var maxDepthMeters: Double
    var currentDepthMeters: Double
}

struct FreeDiveSessionEngine {
    private let startedAt: Date
    private let configuration: FreeDiveSegmentationConfiguration
    private var samples: [DepthSample] = []
    private var segments: [FreeDiveSegment] = []
    private var activeStartIndex: Int?
    private var sustainedDescentStartedAt: Date?
    private var surfaceCandidateStartedAt: Date?
    private(set) var state: FreeDiveSessionState = .surfaceReady

    init(
        startedAt: Date,
        configuration: FreeDiveSegmentationConfiguration = FreeDiveSegmentationConfiguration()
    ) {
        self.startedAt = startedAt
        self.configuration = configuration
    }

    var snapshot: FreeDiveSessionSnapshot {
        FreeDiveSessionSnapshot(
            state: state,
            segments: segments,
            activeSegment: activeSegment,
            diveCount: segments.count + (activeSegment == nil ? 0 : 1),
            maxDepthMeters: max(segments.map(\.maxDepthMeters).max() ?? 0, activeSegment?.maxDepthMeters ?? 0),
            currentDepthMeters: samples.last?.depthMeters ?? 0
        )
    }

    var activeSegment: FreeDiveSegment? {
        guard let activeStartIndex, activeStartIndex < samples.count, let latest = samples.last else {
            return nil
        }
        let segmentSamples = Array(samples[activeStartIndex..<samples.count])
        return makeSegment(index: segments.count + 1, startIndex: activeStartIndex, endIndex: samples.count - 1, endTime: latest.timestamp, samples: segmentSamples)
    }

    mutating func append(_ sample: DepthSample) {
        samples.append(sample)
        switch state {
        case .surfaceReady, .surfaceInterval:
            updateSurfaceState(with: sample)
        case .diveActive:
            updateDiveState(with: sample)
        case .summary:
            break
        }
    }

    func surfaceInterval(at date: Date) -> TimeInterval {
        guard let previousEnd = segments.last?.endTime else { return 0 }
        return max(0, date.timeIntervalSince(previousEnd))
    }

    mutating func finish(at date: Date) -> FreeDiveSession {
        if let active = activeSegment {
            segments.append(
                FreeDiveSegment(
                    id: active.id,
                    index: active.index,
                    startTime: active.startTime,
                    endTime: date,
                    durationSeconds: max(0, date.timeIntervalSince(active.startTime)),
                    maxDepthMeters: active.maxDepthMeters,
                    minDepthMeters: active.minDepthMeters,
                    sampleStartIndex: active.sampleStartIndex,
                    sampleEndIndex: active.sampleEndIndex,
                    descentRateMetersPerSecond: active.descentRateMetersPerSecond,
                    ascentRateMetersPerSecond: active.ascentRateMetersPerSecond
                )
            )
        }
        activeStartIndex = nil
        state = .summary
        return makeSession(endedAt: date)
    }

    private mutating func updateSurfaceState(with sample: DepthSample) {
        guard sample.depthMeters >= configuration.diveStartDepthThreshold else {
            sustainedDescentStartedAt = nil
            return
        }

        if sustainedDescentStartedAt == nil {
            sustainedDescentStartedAt = sample.timestamp
        }

        guard let descentStart = sustainedDescentStartedAt,
              sample.timestamp.timeIntervalSince(descentStart) >= configuration.sustainedDescentDuration else {
            return
        }

        activeStartIndex = max(0, samples.count - 1)
        surfaceCandidateStartedAt = nil
        state = .diveActive
    }

    private mutating func updateDiveState(with sample: DepthSample) {
        guard sample.depthMeters <= configuration.surfaceDepthThreshold else {
            surfaceCandidateStartedAt = nil
            return
        }

        if surfaceCandidateStartedAt == nil {
            surfaceCandidateStartedAt = sample.timestamp
        }

        guard let surfaceStart = surfaceCandidateStartedAt,
              sample.timestamp.timeIntervalSince(surfaceStart) >= configuration.surfaceConfirmDuration,
              let active = activeSegment else {
            return
        }

        segments.append(active)
        activeStartIndex = nil
        sustainedDescentStartedAt = nil
        surfaceCandidateStartedAt = nil
        state = .surfaceInterval
    }

    private func makeSession(endedAt: Date) -> FreeDiveSession {
        FreeDiveSession(
            id: UUID(),
            startTime: startedAt,
            endTime: endedAt,
            totalDurationSeconds: max(0, endedAt.timeIntervalSince(startedAt)),
            maxDepthMeters: segments.map(\.maxDepthMeters).max() ?? 0,
            diveCount: segments.count,
            longestDiveDurationSeconds: segments.map(\.durationSeconds).max() ?? 0,
            segments: segments
        )
    }

    private func makeSegment(index: Int, startIndex: Int, endIndex: Int, endTime: Date, samples segmentSamples: [DepthSample]) -> FreeDiveSegment {
        let start = segmentSamples.first?.timestamp ?? endTime
        return FreeDiveSegment(
            id: UUID(),
            index: index,
            startTime: start,
            endTime: endTime,
            durationSeconds: max(0, endTime.timeIntervalSince(start)),
            maxDepthMeters: segmentSamples.map(\.depthMeters).max() ?? 0,
            minDepthMeters: segmentSamples.map(\.depthMeters).min() ?? 0,
            sampleStartIndex: startIndex,
            sampleEndIndex: endIndex,
            descentRateMetersPerSecond: nil,
            ascentRateMetersPerSecond: nil
        )
    }
}
```

- [ ] **Step 4: Run tests and verify freedive tests pass**

Run the `DiveWatchAppTests` command from Task 1.

Expected: `FreeDiveSessionEngineTests` and migration tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Recording/FreeDiveSessionEngine.swift apps/mobile/ios/DiveWatchAppTests/FreeDiveSessionEngineTests.swift apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: segment freedive sessions on watch"
```

---

### Task 4: Implement Safety Stop Controller

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
- Test: `apps/mobile/ios/DiveWatchAppTests/SafetyStopControllerTests.swift`

- [ ] **Step 1: Write safety stop tests**

```swift
import XCTest
@testable import DiveWatchApp

final class SafetyStopControllerTests: XCTestCase {
    func testMaxDepthBelowTenMetersIsNotRequired() {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 9.9, sample: EngineTestFixtures.sample(0, depth: 4))

        XCTAssertEqual(controller.record.status, .notRequired)
        XCTAssertFalse(controller.record.required)
    }

    func testMaxDepthAtTenMetersArmsStop() {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 10, sample: EngineTestFixtures.sample(0, depth: 10))

        XCTAssertEqual(controller.record.status, .armed)
        XCTAssertTrue(controller.record.required)
    }

    func testEnteringZoneStartsCountdown() {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(0, depth: 12))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(2, depth: 5))

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.startedAt, EngineTestFixtures.date(2))
    }

    func testInsideZoneDecrementsTimer() {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(0, depth: 12))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(2, depth: 5))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(12, depth: 4.8))

        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
    }

    func testTooDeepPausesTimer() {
        var controller = activeController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(12, depth: 6.8))

        XCTAssertEqual(controller.record.status, .pausedTooDeep)
        XCTAssertEqual(controller.record.remainingSeconds, 180, accuracy: 0.01)
    }

    func testTooShallowPausesTimer() {
        var controller = activeController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(12, depth: 2.1))

        XCTAssertEqual(controller.record.status, .pausedTooShallow)
        XCTAssertEqual(controller.record.remainingSeconds, 180, accuracy: 0.01)
    }

    func testReEnteringZoneResumesTimer() {
        var controller = activeController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(12, depth: 6.8))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(18, depth: 4.9))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(28, depth: 4.8))

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
    }

    func testCountdownReachingZeroMarksCompleted() {
        var controller = activeController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(180, depth: 5))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(182, depth: 5))

        XCTAssertEqual(controller.record.status, .completed)
        XCTAssertTrue(controller.record.completed)
        XCTAssertEqual(controller.record.remainingSeconds, 0, accuracy: 0.01)
    }

    func testSurfacingBeforeCompletionMarksIncomplete() {
        var controller = activeController()
        controller.markSurfaced(at: EngineTestFixtures.date(40))

        XCTAssertEqual(controller.record.status, .skippedOrIncomplete)
        XCTAssertFalse(controller.record.completed)
    }

    func testStatusTextDoesNotExposeBannedSafetyPhrases() {
        let labels = SafetyStopStatus.allCases.map(\.displayText)
        let joined = labels.joined(separator: " ")

        XCTAssertFalse(joined.localizedCaseInsensitiveContains("safe to ascend"))
        XCTAssertFalse(joined.contains("상승 가능"))
        XCTAssertFalse(joined.contains("이제 안전합니다"))
        XCTAssertFalse(joined.contains("감압 완료"))
    }

    private func activeController() -> SafetyStopController {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(0, depth: 12))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(2, depth: 5))
        return controller
    }
}
```

- [ ] **Step 2: Run tests and verify failure**

Expected: fails because `SafetyStopController`, `allCases`, and display text are missing.

- [ ] **Step 3: Implement controller**

```swift
import Foundation

struct SafetyStopConfiguration: Equatable {
    var armDepthMeters: Double = 10
    var targetDepthMeters: Double = 5
    var displayMinDepthMeters: Double = 3
    var displayMaxDepthMeters: Double = 6
    var countingMinDepthMeters: Double = 2.7
    var countingMaxDepthMeters: Double = 6.3
    var durationSeconds: TimeInterval = 180
    var stableTransitionDuration: TimeInterval = 2
}

struct SafetyStopController {
    private let configuration: SafetyStopConfiguration
    private var lastSample: DepthSample?
    private var startedAt: Date?
    private var completedAt: Date?
    private var remainingSeconds: TimeInterval
    private var timeInZoneSeconds: TimeInterval = 0
    private var status: SafetyStopStatus = .notRequired

    init(configuration: SafetyStopConfiguration = SafetyStopConfiguration()) {
        self.configuration = configuration
        remainingSeconds = configuration.durationSeconds
    }

    var record: SafetyStopRecord {
        SafetyStopRecord(
            status: status,
            required: status != .notRequired && status != .unknown,
            completed: status == .completed,
            targetDepthMeters: configuration.targetDepthMeters,
            minDepthMeters: configuration.displayMinDepthMeters,
            maxDepthMeters: configuration.displayMaxDepthMeters,
            durationSeconds: configuration.durationSeconds,
            startedAt: startedAt,
            completedAt: completedAt,
            remainingSeconds: remainingSeconds,
            timeInZoneSeconds: timeInZoneSeconds
        )
    }

    mutating func update(maxDepthMeters: Double, sample: DepthSample) {
        defer { lastSample = sample }

        guard maxDepthMeters >= configuration.armDepthMeters else {
            status = .notRequired
            return
        }

        if status == .notRequired {
            status = .armed
        }

        guard status != .completed && status != .skippedOrIncomplete else {
            return
        }

        let zoneStatus = zoneStatus(for: sample.depthMeters)
        switch zoneStatus {
        case .inside:
            if startedAt == nil {
                startedAt = sample.timestamp
            }
            let elapsed = elapsedSinceLastSample(to: sample)
            remainingSeconds = max(0, remainingSeconds - elapsed)
            timeInZoneSeconds += elapsed
            status = remainingSeconds <= 0 ? .completed : .active
            if status == .completed {
                completedAt = sample.timestamp
            }
        case .tooDeep:
            status = .pausedTooDeep
        case .tooShallow:
            status = .pausedTooShallow
        }
    }

    mutating func markSurfaced(at date: Date) {
        guard status != .completed && status != .notRequired else { return }
        status = .skippedOrIncomplete
    }

    private func elapsedSinceLastSample(to sample: DepthSample) -> TimeInterval {
        guard let lastSample else { return 0 }
        return max(0, sample.timestamp.timeIntervalSince(lastSample.timestamp))
    }

    private func zoneStatus(for depth: Double) -> ZoneStatus {
        if depth < configuration.countingMinDepthMeters {
            return .tooShallow
        }
        if depth > configuration.countingMaxDepthMeters {
            return .tooDeep
        }
        return .inside
    }

    private enum ZoneStatus {
        case inside
        case tooDeep
        case tooShallow
    }
}

extension SafetyStopStatus: CaseIterable {
    var displayText: String {
        switch self {
        case .unknown:
            return String(localized: "Stop status unavailable")
        case .notRequired:
            return String(localized: "Stop not required")
        case .armed:
            return String(localized: "Stop reminder armed")
        case .active:
            return String(localized: "Within stop zone")
        case .pausedTooDeep:
            return String(localized: "Deeper than stop zone")
        case .pausedTooShallow:
            return String(localized: "Shallower than stop zone")
        case .completed:
            return String(localized: "Recommended stop complete")
        case .skippedOrIncomplete:
            return String(localized: "Stop incomplete")
        }
    }
}
```

- [ ] **Step 4: Run tests and verify controller tests pass**

Expected: `SafetyStopControllerTests` pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift apps/mobile/ios/DiveWatchAppTests/SafetyStopControllerTests.swift apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: add scuba safety stop controller"
```

---

### Task 5: Implement Scuba Dive Engine

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift`
- Test: `apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift`

- [ ] **Step 1: Write scuba engine tests**

```swift
import XCTest
@testable import DiveWatchApp

final class ScubaDiveEngineTests: XCTestCase {
    func testEngineTracksMaxDepthAndSafetyStopRecord() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: "Air")
        engine.append(EngineTestFixtures.sample(0, depth: 0))
        engine.append(EngineTestFixtures.sample(60, depth: 21.2))
        engine.append(EngineTestFixtures.sample(600, depth: 5))
        engine.append(EngineTestFixtures.sample(780, depth: 5))

        let session = engine.finish(at: EngineTestFixtures.date(900))

        XCTAssertEqual(session.maxDepthMeters, 21.2)
        XCTAssertEqual(session.gasLabel, "Air")
        XCTAssertEqual(session.safetyStop.status, .completed)
        XCTAssertEqual(session.safetyStop.remainingSeconds, 0, accuracy: 0.01)
    }
}
```

- [ ] **Step 2: Run tests and verify failure**

Expected: fails because `ScubaDiveEngine` is missing.

- [ ] **Step 3: Implement scuba engine**

```swift
import Foundation

struct ScubaDiveEngine {
    private let startedAt: Date
    private let gasLabel: String?
    private var samples: [DepthSample] = []
    private var safetyStopController = SafetyStopController()
    private var maxDepthMeters: Double = 0
    private var latestAscentRateMetersPerMinute: Double = 0
    private var maxAscentRateMetersPerMinute: Double = 0

    init(startedAt: Date, gasLabel: String?) {
        self.startedAt = startedAt
        self.gasLabel = gasLabel
    }

    var currentDepthMeters: Double {
        samples.last?.depthMeters ?? 0
    }

    var safetyStopRecord: SafetyStopRecord {
        safetyStopController.record
    }

    mutating func append(_ sample: DepthSample) {
        let previous = samples.last
        samples.append(sample)
        maxDepthMeters = max(maxDepthMeters, sample.depthMeters)
        latestAscentRateMetersPerMinute = Self.ascentRate(from: previous, to: sample)
        maxAscentRateMetersPerMinute = max(maxAscentRateMetersPerMinute, latestAscentRateMetersPerMinute)
        safetyStopController.update(maxDepthMeters: maxDepthMeters, sample: sample)
    }

    mutating func finish(at date: Date) -> ScubaDiveSession {
        if currentDepthMeters <= 0.8 {
            safetyStopController.markSurfaced(at: date)
        }
        return ScubaDiveSession(
            id: UUID(),
            startTime: startedAt,
            endTime: date,
            durationSeconds: max(0, date.timeIntervalSince(startedAt)),
            maxDepthMeters: maxDepthMeters,
            averageDepthMeters: averageDepth,
            waterTemperatureCelsius: averageTemperature,
            gasLabel: gasLabel,
            latestAscentRateMetersPerMinute: latestAscentRateMetersPerMinute,
            maxAscentRateMetersPerMinute: maxAscentRateMetersPerMinute,
            safetyStop: safetyStopController.record
        )
    }

    private var averageDepth: Double {
        guard !samples.isEmpty else { return 0 }
        return samples.reduce(0) { $0 + $1.depthMeters } / Double(samples.count)
    }

    private var averageTemperature: Double? {
        guard !samples.isEmpty else { return nil }
        return samples.reduce(0) { $0 + $1.waterTemperatureCelsius } / Double(samples.count)
    }

    private static func ascentRate(from previous: DepthSample?, to current: DepthSample) -> Double {
        guard let previous else { return 0 }
        let elapsed = current.timestamp.timeIntervalSince(previous.timestamp)
        guard elapsed > 0, current.depthMeters < previous.depthMeters else { return 0 }
        return (previous.depthMeters - current.depthMeters) / elapsed * 60
    }
}
```

- [ ] **Step 4: Run tests and verify scuba engine tests pass**

Expected: `ScubaDiveEngineTests` pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: add scuba dive engine"
```

---

### Task 6: Integrate Engines Into Recorder And Store

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - Change enqueue and sync payload calls from legacy `DiveSession` to `DiveSessionRecord`.

- [ ] **Step 1: Add recorder integration source scan**

Add expectations to `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`:

```ts
it('keeps watch recording state in mode-specific engines', () => {
  const recorder = readRepoFile('apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift');

  expect(recorder).toContain('FreeDiveSessionEngine');
  expect(recorder).toContain('ScubaDiveEngine');
  expect(recorder).toContain('DiveSessionRecord');
  expect(recorder).not.toContain('private func updateSafetyStop');
});
```

- [ ] **Step 2: Run Jest source test and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
```

Expected: fails because recorder still owns safety stop logic and returns `DiveSession`.

- [ ] **Step 3: Refactor recorder state**

Change `DiveSessionRecorder` published state to expose a mode-aware snapshot. Preserve existing `currentDepth`, `maxDepth`, `elapsedTime`, and temperature accessors while adding:

```swift
@Published private(set) var currentRecordPayload: DiveSessionPayload?
@Published private(set) var freeSnapshot: FreeDiveSessionSnapshot?
@Published private(set) var scubaSafetyStop: SafetyStopRecord = .legacyUnknown
```

Use mode-specific engine storage:

```swift
private var freeEngine: FreeDiveSessionEngine?
private var scubaEngine: ScubaDiveEngine?
```

In `startSession(plan:)`, initialize the matching engine:

```swift
switch plan.diveMode {
case .freedive:
    freeEngine = FreeDiveSessionEngine(startedAt: startedAt)
    scubaEngine = nil
case .scuba:
    scubaEngine = ScubaDiveEngine(startedAt: startedAt, gasLabel: plan.gasLabel)
    freeEngine = nil
}
```

In `append(_:)`, delegate:

```swift
switch activePlan.diveMode {
case .freedive:
    freeEngine?.append(sample)
    freeSnapshot = freeEngine?.snapshot
    maxDepth = freeSnapshot?.maxDepthMeters ?? max(maxDepth, sample.depthMeters)
case .scuba:
    scubaEngine?.append(sample)
    scubaSafetyStop = scubaEngine?.safetyStopRecord ?? .legacyUnknown
    maxDepth = max(maxDepth, sample.depthMeters)
}
```

Remove `updateSafetyStop(with:previousSample:)` from `DiveSessionRecorder`.

- [ ] **Step 4: Change `stopSession()` to return `DiveSessionRecord?`**

Build shell metadata from the old initializer values, and set payload from the active engine:

```swift
let payload: DiveSessionPayload
switch activePlan.diveMode {
case .freedive:
    guard var engine = freeEngine else { return nil }
    payload = .freedive(engine.finish(at: Date()))
case .scuba:
    guard var engine = scubaEngine else { return nil }
    payload = .scuba(engine.finish(at: Date()))
}

return DiveSessionRecord(
    id: UUID(),
    schemaVersion: 2,
    diveMode: activePlan.diveMode,
    siteId: nil,
    siteName: activePlan.siteName.isEmpty ? nil : activePlan.siteName,
    sourcePlanLocalId: activePlan.sourcePlanLocalId,
    planTitle: activePlan.title.isEmpty ? nil : activePlan.title,
    buddyIds: activePlan.buddyIds,
    gearIds: activePlan.gearIds,
    tags: sessionTags,
    notes: activePlan.quickNote.isEmpty ? nil : activePlan.quickNote,
    rating: nil,
    perceivedExertion: nil,
    visibilityRating: nil,
    waterCondition: .unknown,
    syncStatus: .pending,
    entryLocation: nil,
    exitLocation: nil,
    startedAt: startedAt,
    endedAt: Date(),
    samples: samples,
    payload: payload
)
```

- [ ] **Step 5: Update store to persist records and migrate old sessions**

Keep old key readable:

```swift
private let storageKey = "savedDiveSessionRecords"
private let legacyStorageKey = "savedDiveSessions"
```

In `load()`, first decode `[DiveSessionRecord]`. If not present, decode `[DiveSession]` and map:

```swift
sessions = try JSONDecoder().decode([DiveSessionRecord].self, from: data)
```

Legacy fallback:

```swift
let legacySessions = try JSONDecoder().decode([DiveSession].self, from: legacyData)
sessions = legacySessions.map(DiveSessionRecord.init(legacySession:)).sorted { $0.startedAt > $1.startedAt }
persist()
```

- [ ] **Step 6: Run tests**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
xcodebuild -project ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' -derivedDataPath /private/tmp/DiveWatchAppTestsDerivedData CODE_SIGNING_ALLOWED=NO test
```

Expected: source test and engine tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "feat: persist mode-aware watch session records"
```

---

### Task 7: Update Watch Sync Contract And Fixtures

**Files:**
- Modify: `packages/contracts/schemas/watch-session.schema.json`
- Create: `packages/contracts/fixtures/freedive-multi-segment-watch-sync-message.json`
- Create: `packages/contracts/fixtures/scuba-safety-stop-watch-sync-message.json`
- Modify: existing contract fixtures
- Regenerate: `packages/contracts/generated/typescript/index.ts`
- Regenerate: `packages/contracts/generated/swift/WatchContracts.swift`

- [ ] **Step 1: Update schema with mode payloads**

Use nested `freedive` and `scuba` payload definitions. Keep `additionalProperties: false`.

Key shape:

```json
{
  "properties": {
    "diveMode": { "type": "string", "enum": ["scuba", "freedive"] },
    "freedive": { "$ref": "#/definitions/freeDivePayload" },
    "scuba": { "$ref": "#/definitions/scubaPayload" }
  },
  "allOf": [
    {
      "if": { "properties": { "diveMode": { "const": "freedive" } }, "required": ["diveMode"] },
      "then": { "required": ["freedive"], "not": { "required": ["scuba"] } }
    },
    {
      "if": { "properties": { "diveMode": { "const": "scuba" } }, "required": ["diveMode"] },
      "then": { "required": ["scuba"], "not": { "required": ["freedive"] } }
    }
  ]
}
```

Add `freeDiveSegment`, `freeDivePayload`, `safetyStopRecord`, and `scubaPayload` definitions with the fields from the design spec.

- [ ] **Step 2: Add fixtures**

Freedive fixture must include two segments in one session:

```json
{
  "type": "sessionEnded",
  "session": {
    "localSessionId": "watch-free-001",
    "schemaVersion": 2,
    "diveMode": "freedive",
    "startedAt": 1783225525,
    "endedAt": 1783225825,
    "syncStatus": "pending",
    "samples": [],
    "freedive": {
      "diveCount": 2,
      "maxDepthMeters": 18.4,
      "longestDiveDurationSeconds": 46,
      "segments": [
        {
          "segmentId": "free-segment-001",
          "index": 1,
          "startedAt": 1783225530,
          "endedAt": 1783225576,
          "durationSeconds": 46,
          "maxDepthMeters": 18.4,
          "minDepthMeters": 0.4,
          "sampleStartIndex": 0,
          "sampleEndIndex": 10
        },
        {
          "segmentId": "free-segment-002",
          "index": 2,
          "startedAt": 1783225700,
          "endedAt": 1783225738,
          "durationSeconds": 38,
          "maxDepthMeters": 15.2,
          "minDepthMeters": 0.5,
          "sampleStartIndex": 11,
          "sampleEndIndex": 20
        }
      ]
    }
  }
}
```

Scuba fixture must include completed safety stop:

```json
{
  "type": "sessionEnded",
  "session": {
    "localSessionId": "watch-scuba-001",
    "schemaVersion": 2,
    "diveMode": "scuba",
    "startedAt": 1783225525,
    "endedAt": 1783228045,
    "syncStatus": "pending",
    "samples": [],
    "scuba": {
      "gasLabel": "Air",
      "maxDepthMeters": 21.2,
      "averageDepthMeters": 12.4,
      "waterTemperatureCelsius": 24,
      "latestAscentRateMetersPerMinute": 0.2,
      "maxAscentRateMetersPerMinute": 7.8,
      "safetyStop": {
        "status": "completed",
        "required": true,
        "completed": true,
        "targetDepthMeters": 5,
        "minDepthMeters": 3,
        "maxDepthMeters": 6,
        "durationSeconds": 180,
        "startedAt": 1783227800,
        "completedAt": 1783227980,
        "remainingSeconds": 0,
        "timeInZoneSeconds": 180
      }
    }
  }
}
```

- [ ] **Step 3: Regenerate contracts**

Run:

```bash
yarn check:quick
```

Expected: generated TypeScript and Swift files update without manual edits.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/schemas/watch-session.schema.json packages/contracts/fixtures packages/contracts/generated/typescript/index.ts packages/contracts/generated/swift/WatchContracts.swift
git commit -m "feat: extend watch sync contract for mode payloads"
```

---

### Task 8: Update Mobile Watch Sync Validator

**Files:**
- Modify: `apps/mobile/src/utils/watch-sync-message-validation.ts`
- Create or modify: `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
  - Add mode payload validation tests if the file exists; otherwise create it with the tests in this task.

- [ ] **Step 1: Add validator tests**

```ts
import { parseWatchSyncMessageValue } from '../src/utils/watch-sync-message-validation';

describe('watch sync mode payload validation', () => {
  it('accepts freedive sessions with segments', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'watch-free-001',
        schemaVersion: 2,
        diveMode: 'freedive',
        startedAt: 1783225525,
        samples: [],
        freedive: {
          diveCount: 1,
          maxDepthMeters: 12,
          longestDiveDurationSeconds: 40,
          segments: [{
            segmentId: 'seg-1',
            index: 1,
            startedAt: 1783225530,
            endedAt: 1783225570,
            durationSeconds: 40,
            maxDepthMeters: 12,
            minDepthMeters: 0.5,
            sampleStartIndex: 0,
            sampleEndIndex: 4,
          }],
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects freedive sessions without freedive payload', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'watch-free-001',
        schemaVersion: 2,
        diveMode: 'freedive',
        startedAt: 1783225525,
        samples: [],
      },
    });

    expect(result.ok).toBe(false);
  });

  it('accepts scuba sessions with safety stop record', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'watch-scuba-001',
        schemaVersion: 2,
        diveMode: 'scuba',
        startedAt: 1783225525,
        samples: [],
        scuba: {
          gasLabel: 'Air',
          maxDepthMeters: 21.2,
          averageDepthMeters: 12.4,
          safetyStop: {
            status: 'completed',
            required: true,
            completed: true,
            targetDepthMeters: 5,
            minDepthMeters: 3,
            maxDepthMeters: 6,
            durationSeconds: 180,
            remainingSeconds: 0,
            timeInZoneSeconds: 180,
          },
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects mismatched scuba and freedive payloads', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'watch-scuba-001',
        schemaVersion: 2,
        diveMode: 'scuba',
        startedAt: 1783225525,
        samples: [],
        freedive: {
          diveCount: 0,
          maxDepthMeters: 0,
          longestDiveDurationSeconds: 0,
          segments: [],
        },
      },
    });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run validator tests and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-sync-message-validation.test.ts
```

Expected: fails because validator does not know `freedive` and `scuba` payload keys.

- [ ] **Step 3: Add allowed keys and payload parsers**

Add keys:

```ts
const sessionKeys = [
  // existing keys...
  'samples',
  'freedive',
  'scuba',
] as const;

const freeDiveKeys = ['diveCount', 'maxDepthMeters', 'longestDiveDurationSeconds', 'segments'] as const;
const freeDiveSegmentKeys = [
  'segmentId',
  'index',
  'startedAt',
  'endedAt',
  'durationSeconds',
  'maxDepthMeters',
  'minDepthMeters',
  'sampleStartIndex',
  'sampleEndIndex',
  'descentRateMetersPerSecond',
  'ascentRateMetersPerSecond',
] as const;
const scubaKeys = [
  'gasLabel',
  'maxDepthMeters',
  'averageDepthMeters',
  'waterTemperatureCelsius',
  'latestAscentRateMetersPerMinute',
  'maxAscentRateMetersPerMinute',
  'safetyStop',
] as const;
const safetyStopKeys = [
  'status',
  'required',
  'completed',
  'targetDepthMeters',
  'minDepthMeters',
  'maxDepthMeters',
  'durationSeconds',
  'startedAt',
  'completedAt',
  'remainingSeconds',
  'timeInZoneSeconds',
] as const;
const safetyStopStatuses = [
  'unknown',
  'notRequired',
  'armed',
  'active',
  'pausedTooDeep',
  'pausedTooShallow',
  'completed',
  'skippedOrIncomplete',
] as const;
```

After reading `diveMode`, enforce matching payload:

```ts
if (diveMode.value === 'freedive') {
  const freedive = readObject(objectResult.value, 'freedive', path, parseFreeDivePayload, { required: true });
  if (!freedive.ok || freedive.value === undefined) return freedive.ok ? failure(joinPath(path, 'freedive'), 'freedive is required') : freedive;
  if (objectResult.value.scuba !== undefined) return failure(joinPath(path, 'scuba'), 'scuba is not allowed for freedive sessions');
  assignOptional(session, 'freedive', freedive.value);
}

if (diveMode.value === 'scuba') {
  const scuba = readObject(objectResult.value, 'scuba', path, parseScubaPayload, { required: true });
  if (!scuba.ok || scuba.value === undefined) return scuba.ok ? failure(joinPath(path, 'scuba'), 'scuba is required') : scuba;
  if (objectResult.value.freedive !== undefined) return failure(joinPath(path, 'freedive'), 'freedive is not allowed for scuba sessions');
  assignOptional(session, 'scuba', scuba.value);
}
```

Implement parsers with existing `readNumber`, `readInteger`, `readString`, `readEnum`, and `readArray` helpers.

- [ ] **Step 4: Run validator tests**

Expected: validator tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/utils/watch-sync-message-validation.ts apps/mobile/__tests__/watch-sync-message-validation.test.ts
git commit -m "feat: validate mode-aware watch sync payloads"
```

---

### Task 9: Preserve Mode Metadata In Mobile Import And Detail

**Files:**
- Modify: `apps/mobile/src/types/dive-log-entry.ts`
- Modify: `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- Modify: `apps/mobile/src/utils/session-summary.ts`
- Modify: `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Create or modify: `apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts`
  - Add mode metadata preservation tests if the file exists; otherwise create it with the tests in this task.

- [ ] **Step 1: Add import preservation tests**

```ts
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

describe('watchSessionToDiveLogEntry mode metadata', () => {
  it('preserves freedive segments', () => {
    const entry = watchSessionToDiveLogEntry({
      now: 1783229000,
      session: {
        localSessionId: 'watch-free-001',
        schemaVersion: 2,
        diveMode: 'freedive',
        startedAt: 1783225525,
        samples: [],
        freedive: {
          diveCount: 1,
          maxDepthMeters: 12,
          longestDiveDurationSeconds: 40,
          segments: [{
            segmentId: 'seg-1',
            index: 1,
            startedAt: 1783225530,
            endedAt: 1783225570,
            durationSeconds: 40,
            maxDepthMeters: 12,
            minDepthMeters: 0.5,
            sampleStartIndex: 0,
            sampleEndIndex: 4,
          }],
        },
      },
    });

    expect(entry.watchCapture.session.freedive?.segments).toHaveLength(1);
    expect(entry.watchCapture.measuredValues.maxDepthMeters).toBe(12);
  });

  it('preserves scuba safety stop status', () => {
    const entry = watchSessionToDiveLogEntry({
      now: 1783229000,
      session: {
        localSessionId: 'watch-scuba-001',
        schemaVersion: 2,
        diveMode: 'scuba',
        startedAt: 1783225525,
        samples: [],
        scuba: {
          gasLabel: 'Air',
          maxDepthMeters: 21.2,
          averageDepthMeters: 12.4,
          safetyStop: {
            status: 'completed',
            required: true,
            completed: true,
            targetDepthMeters: 5,
            minDepthMeters: 3,
            maxDepthMeters: 6,
            durationSeconds: 180,
            remainingSeconds: 0,
            timeInZoneSeconds: 180,
          },
        },
      },
    });

    expect(entry.watchCapture.session.scuba?.safetyStop.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-session-to-dive-log-entry.test.ts
```

Expected: fails until generated types and summary helpers support mode payloads.

- [ ] **Step 3: Update summary helpers**

In `session-summary.ts`, prefer mode payload values:

```ts
export const getSessionMaxDepthMeters = (session: Pick<WatchSession, 'maxDepthMeters' | 'samples' | 'freedive' | 'scuba'>): number | undefined => {
  return session.scuba?.maxDepthMeters ?? session.freedive?.maxDepthMeters ?? session.maxDepthMeters ?? maxDepth(session.samples);
};
```

Keep sample fallback for old logs.

- [ ] **Step 4: Add mode sections to log detail**

Render:

```tsx
function WatchModeMetadataSection(props: { session: WatchSession }): React.JSX.Element | null {
  if (props.session.diveMode === 'freedive' && props.session.freedive) {
    return <FreediveSegmentsSection freedive={props.session.freedive} />;
  }

  if (props.session.diveMode === 'scuba' && props.session.scuba?.safetyStop) {
    return <ScubaSafetyStopSection safetyStop={props.session.scuba.safetyStop} />;
  }

  return null;
}
```

Use Korean labels:

- `프리 세션`
- `다이브 수`
- `최장 다이브`
- `수면 휴식`
- `권장 세이프티 스탑`
- `권장 스탑 완료`
- `스탑 미완료`
- `기록 없음`

- [ ] **Step 5: Run focused mobile tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test -- watch-session-to-dive-log-entry.test.ts
yarn mobile:typecheck
```

Expected: tests pass and TypeScript compiles.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/types/dive-log-entry.ts apps/mobile/src/utils/watch-session-to-dive-log-entry.ts apps/mobile/src/utils/session-summary.ts apps/mobile/src/screens/logbook/log-entry-detail.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__
git commit -m "feat: preserve watch mode metadata on mobile"
```

---

### Task 10: Add Deep Blue Minimal Depth Gauge

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`

- [ ] **Step 1: Add source scan for gauge design**

Add to `watch-connectivity-native-source.test.ts`:

```ts
it('uses a deep blue minimal depth gauge on watch live screens', () => {
  const gauge = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift');
  const recording = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift');

  expect(gauge).toContain('struct DepthGaugeRail');
  expect(gauge).toContain('LinearGradient');
  expect(gauge).toContain('stopZone');
  expect(gauge).toContain('Image(systemName: "chevron.right")');
  expect(recording).toContain('DepthGaugeRail');
});
```

- [ ] **Step 2: Run source test and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
```

Expected: fails because gauge file is missing.

- [ ] **Step 3: Implement `DepthGaugeRail`**

```swift
import SwiftUI

struct DepthGaugeRail: View {
    let depthMeters: Double
    let maxScaleMeters: Double
    var stopZone: ClosedRange<Double>?
    var targetDepthMeters: Double?

    var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height
            let markerY = yPosition(for: depthMeters, height: height)

            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(depthGradient)
                    .frame(width: 10)
                    .position(x: 28, y: height / 2)
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(0.22), lineWidth: 1)
                    )

                if let stopZone {
                    stopZoneBox(range: stopZone, height: height)
                }

                if let targetDepthMeters {
                    targetLine(depth: targetDepthMeters, height: height)
                }

                ticks(height: height)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .position(x: 13, y: markerY)

                Circle()
                    .fill(DiveWatchTheme.primary)
                    .frame(width: 13, height: 13)
                    .shadow(color: DiveWatchTheme.primary.opacity(0.72), radius: 8)
                    .position(x: 31, y: markerY)
            }
        }
        .frame(width: 48, height: 150)
        .accessibilityLabel(Text("Depth gauge"))
    }

    private var depthGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.31, green: 0.76, blue: 1.0),
                Color(red: 0.07, green: 0.38, blue: 0.70),
                Color(red: 0.01, green: 0.08, blue: 0.18)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private func yPosition(for depth: Double, height: CGFloat) -> CGFloat {
        let clamped = max(0, min(maxScaleMeters, depth))
        return max(8, min(height - 8, CGFloat(clamped / maxScaleMeters) * height))
    }

    @ViewBuilder
    private func stopZoneBox(range: ClosedRange<Double>, height: CGFloat) -> some View {
        let y1 = yPosition(for: range.lowerBound, height: height)
        let y2 = yPosition(for: range.upperBound, height: height)
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .stroke(Color.green.opacity(0.9), lineWidth: 2)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.green.opacity(0.16))
            )
            .frame(width: 30, height: max(10, y2 - y1))
            .position(x: 28, y: y1 + (y2 - y1) / 2)
    }

    @ViewBuilder
    private func targetLine(depth: Double, height: CGFloat) -> some View {
        Rectangle()
            .fill(Color.green)
            .frame(width: 28, height: 2)
            .position(x: 28, y: yPosition(for: depth, height: height))
    }

    private func ticks(height: CGFloat) -> some View {
        ForEach(tickValues, id: \.self) { value in
            let y = yPosition(for: value, height: height)
            Path { path in
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: 20, y: y))
            }
            .stroke(Color.white.opacity(0.5), lineWidth: 1)
            Text("\(Int(value))")
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .position(x: 7, y: max(5, y - 7))
        }
    }

    private var tickValues: [Double] {
        maxScaleMeters <= 10 ? [0, 3, 5, 6, 10] : [0, 10, 20, 30]
    }
}
```

- [ ] **Step 4: Add previews**

Add below the component:

```swift
#Preview("Depth Gauge") {
    DepthGaugeRail(depthMeters: 18.6, maxScaleMeters: 30)
        .padding()
        .background(Color.black)
}

#Preview("Safety Stop Gauge") {
    DepthGaugeRail(depthMeters: 4.8, maxScaleMeters: 10, stopZone: 3...6, targetDepthMeters: 5)
        .padding()
        .background(Color.black)
}
```

- [ ] **Step 5: Run source test and watch build**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
yarn watch:build
```

Expected: source test and watch build pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "feat: add deep blue watch depth gauge"
```

---

### Task 11: Redesign Watch Home As Launchpad

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`

- [ ] **Step 1: Add source scan for launchpad copy**

```ts
it('keeps watch home focused on starting scuba and free sessions', () => {
  const home = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/HomeView.swift');

  expect(home).toContain('Scuba Start');
  expect(home).toContain('Free Session Start');
  expect(home).toContain('Air · Stop 5m/3:00');
  expect(home).toContain('Supplemental log');
  expect(home).not.toContain('Start Dive');
});
```

- [ ] **Step 2: Run source test and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
```

Expected: fails until Home copy/layout changes.

- [ ] **Step 3: Update Home UI**

Replace the mode picker-first flow with two explicit start links:

```swift
NavigationLink {
    RecordingView(store: store, plan: scubaPlan)
} label: {
    VStack(alignment: .leading, spacing: 4) {
        Label("Scuba Start", systemImage: "play.fill")
        Text("Air · Stop 5m/3:00")
            .font(.system(size: 11, weight: .semibold))
    }
}
.buttonStyle(DiveActionButtonStyle(kind: .primary))

NavigationLink {
    RecordingView(store: store, plan: freePlan)
} label: {
    Label("Free Session Start", systemImage: "figure.pool.swim")
}
.buttonStyle(DiveActionButtonStyle(kind: .secondary))
```

Add computed plans:

```swift
private var scubaPlan: PreDivePlan {
    var next = plan
    next.diveMode = .scuba
    next.gasLabel = next.gasLabel.isEmpty ? "Air" : next.gasLabel
    return next
}

private var freePlan: PreDivePlan {
    var next = plan
    next.diveMode = .freedive
    return next
}
```

Home header source copy:

```swift
Text("Supplemental log · no safety calculation")
```

Korean translation:

```text
보조 로그 · 안전계산 없음
```

- [ ] **Step 4: Run source test and watch UI language check**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
yarn workspace @repo/mobile watch:ui:check
```

Expected: source test passes and UI language check passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Views/HomeView.swift apps/mobile/ios/DiveWatchApp/Localizable.xcstrings apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "feat: make watch home a dive launchpad"
```

---

### Task 12: Build Mode-Specific Live Watch Screens

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/DiveFormatters.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`

- [ ] **Step 1: Add source scan for live state surfaces**

```ts
it('renders mode-specific watch live instruments and safety stop states', () => {
  const recording = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift');

  expect(recording).toContain('FreeSurfaceReadyInstrument');
  expect(recording).toContain('FreeDiveActiveInstrument');
  expect(recording).toContain('FreeSurfaceIntervalInstrument');
  expect(recording).toContain('ScubaLiveInstrument');
  expect(recording).toContain('SafetyStopInstrument');
  expect(recording).toContain('Recommended stop complete');
  expect(recording).not.toContain('safe to ascend');
});
```

- [ ] **Step 2: Run source test and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
```

Expected: fails until live components exist.

- [ ] **Step 3: Add freedive instrument component skeletons**

In `RecordingView.swift`, add private components:

```swift
private struct FreeDiveActiveInstrument: View {
    let depthMeters: Double
    let elapsed: TimeInterval
    let maxDepthMeters: Double
    let verticalRateMetersPerSecond: Double?

    var body: some View {
        InstrumentShell(title: "FREE DIVE") {
            HStack(alignment: .center, spacing: 12) {
                DepthGaugeRail(depthMeters: depthMeters, maxScaleMeters: 30)
                VStack(alignment: .leading, spacing: 14) {
                    Text(DiveFormatters.depth(depthMeters))
                        .font(DiveWatchTheme.metricFont(size: 42, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                    Text(DiveFormatters.duration(elapsed))
                        .font(DiveWatchTheme.metricFont(size: 36, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.text)
                        .monospacedDigit()
                }
            }
            SummaryRow(title: String(localized: "Max"), value: DiveFormatters.depth(maxDepthMeters))
        }
    }
}
```

Add similar `FreeSurfaceReadyInstrument` and `FreeSurfaceIntervalInstrument`, with surface interval time as the dominant value and no large shallow depth.

- [ ] **Step 4: Add scuba safety stop instrument**

```swift
private struct SafetyStopInstrument: View {
    let depthMeters: Double
    let safetyStop: SafetyStopRecord
    let ascentRateMetersPerMinute: Double

    var body: some View {
        InstrumentShell(title: safetyStop.status == .completed ? "STOP COMPLETE" : "SAFETY STOP") {
            HStack(alignment: .center, spacing: 12) {
                DepthGaugeRail(
                    depthMeters: depthMeters,
                    maxScaleMeters: 10,
                    stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters,
                    targetDepthMeters: safetyStop.targetDepthMeters
                )
                VStack(alignment: .leading, spacing: 14) {
                    Text(DiveFormatters.depth(depthMeters))
                        .font(DiveWatchTheme.metricFont(size: 40, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                    Text(DiveFormatters.duration(safetyStop.remainingSeconds))
                        .font(DiveWatchTheme.metricFont(size: 38, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.text)
                }
            }
            Text(statusText)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(statusColor)
            SummaryRow(title: String(localized: "Ascent"), value: DiveFormatters.ascentRate(ascentRateMetersPerMinute))
        }
    }

    private var statusText: String {
        switch safetyStop.status {
        case .completed:
            return String(localized: "Recommended stop complete")
        case .pausedTooDeep:
            return String(localized: "Deeper than stop zone")
        case .pausedTooShallow:
            return String(localized: "Shallower than stop zone")
        default:
            return String(localized: "Within 3-6m stop zone")
        }
    }

    private var statusColor: Color {
        switch safetyStop.status {
        case .pausedTooDeep, .pausedTooShallow:
            return .orange
        default:
            return DiveWatchTheme.text
        }
    }
}
```

- [ ] **Step 5: Wire `recordingContent` to mode snapshots**

Use `plan.diveMode` and recorder snapshots:

```swift
if plan.diveMode == .freedive {
    freediveContent
} else if recorder.scubaSafetyStop.status == .active
    || recorder.scubaSafetyStop.status == .pausedTooDeep
    || recorder.scubaSafetyStop.status == .pausedTooShallow
    || recorder.scubaSafetyStop.status == .completed {
    SafetyStopInstrument(...)
} else {
    ScubaLiveInstrument(...)
}
```

- [ ] **Step 6: Run watch build and UI language check**

Run:

```bash
yarn watch:build
yarn workspace @repo/mobile watch:ui:check
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift apps/mobile/ios/DiveWatchApp/Views/DiveFormatters.swift apps/mobile/ios/DiveWatchApp/Localizable.xcstrings apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "feat: add mode-specific watch live instruments"
```

---

### Task 13: Update Watch Summary, Detail, And Sync Encoding

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`

- [ ] **Step 1: Add source scan for summary/detail mode sections**

```ts
it('shows watch summaries for freedive segments and scuba safety stops', () => {
  const summary = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift');
  const detail = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift');

  expect(summary).toContain('Free Session Summary');
  expect(summary).toContain('Safety Stop Summary');
  expect(detail).toContain('Free Segment List');
  expect(detail).toContain('Safety Stop Result');
});
```

- [ ] **Step 2: Run source test and verify failure**

Run:

```bash
yarn workspace @repo/mobile test -- watch-connectivity-native-source.test.ts
```

Expected: fails until summary/detail sections exist.

- [ ] **Step 3: Update `SummaryView` and `SessionDetailView` signatures**

Change both from `DiveSession` to `DiveSessionRecord`.

For free summary, render:

```swift
SummaryRow(title: String(localized: "Dive count"), value: "\(session.diveCount)")
SummaryRow(title: String(localized: "Longest dive"), value: DiveFormatters.duration(session.longestDiveDurationSeconds))
```

For scuba summary, render:

```swift
SummaryRow(title: String(localized: "Safety stop"), value: session.safetyStop.status.displayText)
SummaryRow(title: String(localized: "Remaining"), value: DiveFormatters.duration(session.safetyStop.remainingSeconds))
```

- [ ] **Step 4: Update sync encoding**

Move `syncMessageData(type:)` behavior to `DiveSessionRecord` and encode nested `freedive` or `scuba` payloads matching the schema. Keep sample payload preservation:

```swift
func syncMessageData(type: String = "sessionEnded") throws -> Data {
    let message = WatchSyncMessagePayload(type: type, session: WatchSessionPayload(record: self))
    return try JSONEncoder().encode(message)
}
```

The `WatchSessionPayload(record:)` initializer must switch on `record.payload` and set exactly one nested payload.

- [ ] **Step 5: Run watch build and contract check**

Run:

```bash
yarn check:quick
yarn watch:build
```

Expected: generated contracts remain unchanged after Swift payload encoding work, watch builds.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift apps/mobile/ios/DiveWatchApp/Localizable.xcstrings apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "feat: summarize mode-aware watch sessions"
```

---

### Task 14: Add Safety Copy Guards And Final Watch Previews

**Files:**
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`

- [ ] **Step 1: Add banned copy checks**

In `check-watch-ui-language.mjs`, include banned strings:

```js
const bannedWatchCopy = [
  'safe to ascend',
  '상승 가능',
  '이제 안전합니다',
  '안전 확보',
  '감압 완료',
  'deco clear',
  'ceiling clear',
];
```

The script should fail if any active watch Swift or `.xcstrings` source contains these outside a test-only allowlist.

- [ ] **Step 2: Add previews or fixture states**

Add SwiftUI previews for:

```swift
#Preview("Free Surface Ready") { FreeSurfaceReadyInstrument(...) }
#Preview("Free Dive Active") { FreeDiveActiveInstrument(...) }
#Preview("Free Surface Interval") { FreeSurfaceIntervalInstrument(...) }
#Preview("Scuba Active") { ScubaLiveInstrument(...) }
#Preview("Safety Stop Inside") { SafetyStopInstrument(...) }
#Preview("Safety Stop Too Deep") { SafetyStopInstrument(...) }
#Preview("Safety Stop Too Shallow") { SafetyStopInstrument(...) }
#Preview("Stop Complete") { SafetyStopInstrument(...) }
```

Use fixed data from `Date(timeIntervalSince1970:)` and literal metric values.

- [ ] **Step 3: Run UI language check**

Run:

```bash
yarn workspace @repo/mobile watch:ui:check
```

Expected: passes and rejects banned strings when temporarily inserted. Remove the temporary insertion before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/scripts/check-watch-ui-language.mjs apps/mobile/__tests__/watch-connectivity-native-source.test.ts apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift
git commit -m "test: guard watch safety copy"
```

---

### Task 15: Final Verification And Project Knowledge Update

**Files:**
- Modify: `.wiki/raw/architecture/watch-app.md`
- Modify: `.wiki/raw/architecture/sync-flow.md`
- Modify: `.wiki/wiki/architecture/watch-app.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/log.md`

- [ ] **Step 1: Run contract generation**

Run:

```bash
yarn check:quick
```

Expected: succeeds.

- [ ] **Step 2: Run mobile tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test
yarn mobile:typecheck
```

Expected: both succeed.

- [ ] **Step 3: Run watch tests and build**

Run:

```bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' -derivedDataPath /private/tmp/DiveWatchAppTestsDerivedData CODE_SIGNING_ALLOWED=NO test
yarn watch:build
yarn workspace @repo/mobile watch:ui:check
```

Expected: all succeed. If simulator destination name is unavailable, run `yarn workspace @repo/mobile watch:list` and use an installed watchOS simulator destination.

- [ ] **Step 4: Run full handoff gate**

Run:

```bash
yarn codex:check
```

Expected: succeeds. Treat Yarn cache/global-folder warnings and CoreSimulator log permission warnings as environment warnings only when command exit code is 0.

- [ ] **Step 5: Update wiki**

Document:

- Watch architecture now uses mode-specific engines.
- Freedive sessions contain multiple segments.
- Scuba safety stop is a recommended reminder, not decompression logic.
- Watch sync contract uses mode-specific nested payloads.
- Actual Apple Watch underwater sensor behavior remains unverified.

Keep Korean safety-boundary style consistent with existing wiki pages.

- [ ] **Step 6: Commit final docs**

```bash
git add .wiki/raw/architecture/watch-app.md .wiki/raw/architecture/sync-flow.md .wiki/wiki/architecture/watch-app.md .wiki/wiki/architecture/sync-flow.md .wiki/wiki/log.md
git commit -m "docs: update watch mode architecture knowledge"
```

- [ ] **Step 7: Prepare handoff summary**

Include:

- Changed files grouped by watch engine/model/UI, contract/mobile, tests, docs.
- Freedive multi-segment behavior summary.
- Scuba safety stop reminder behavior summary.
- Limitations: mock depth provider, no certified safety calculation, real hardware validation still needed.
- Manual Apple Watch/simulator scenarios:
  - Start free session, shallow noise, first dive, surface interval, second dive, end session.
  - Start scuba, exceed 10m, enter stop zone, pause too deep, pause too shallow, complete stop, surface before completion.
  - Verify no banned safety copy appears in Korean or English.

---

## Plan Self-Review

- Spec coverage: covered architecture, data model, freedive state machine, scuba safety stop, watch UI with Minimal Scale gauge, mobile import/detail, migration, tests, verification, limitations, and safety copy.
- Red-flag scan: no intentionally vague tasks are left open; each task contains concrete file paths, code snippets, commands, and expected results.
- Type consistency: Swift model names used across tasks are `DiveSessionRecord`, `DiveSessionPayload`, `FreeDiveSession`, `FreeDiveSegment`, `ScubaDiveSession`, `SafetyStopRecord`, `SafetyStopStatus`, `FreeDiveSessionEngine`, `ScubaDiveEngine`, and `SafetyStopController`.
