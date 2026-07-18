import WatchKit
import XCTest
@testable import DivenaryWatchApp

@MainActor
final class RealDiveSessionCoordinatorTests: XCTestCase {
    func testManualStartPreservesPlanStartsRecorderBeforeRuntimeAndDonatesEndAction() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)
        let plan = PreDivePlan(
            sourcePlanLocalId: "plan-7",
            title: "Morning reef",
            diveMode: .freedive,
            gasLabel: "Air",
            siteName: "East reef",
            buddyName: "Taylor",
            gearIds: ["mask"],
            userTags: ["calm"],
            quickNote: "Check buoyancy",
            plannedMaxDepthMeters: 14,
            plannedDurationMinutes: 40
        )

        coordinator.startManual(plan: plan)

        XCTAssertEqual(recorder.startedPlans, [plan])
        XCTAssertEqual(calls.values.prefix(2), ["recorder.start", "runtime.startManual"])
        XCTAssertEqual(donor.callCount, 1)
        assertRecording(coordinator, source: .manual)
    }

    func testActionButtonStartUsesPreferredModeAndStartsManualRuntimeWithoutDonation() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(
            preferredMode: .freedive,
            runtime: runtime,
            recorder: recorder,
            donor: donor
        )

        coordinator.startFromActionButton()

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
        XCTAssertEqual(runtime.startManualCallCount, 1)
        XCTAssertEqual(donor.callCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testAdoptedSystemSessionUsesPreferredModeImmediatelyWithoutStartingRuntimeAndDonatesEndAction() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(
            preferredMode: .freedive,
            runtime: runtime,
            recorder: recorder,
            donor: donor
        )

        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
        XCTAssertEqual(runtime.startManualCallCount, 0)
        XCTAssertEqual(donor.callCount, 1)
        assertRecording(coordinator, source: .systemAutoLaunch)
    }

    func testDonationFailureDoesNotCancelRecording() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls, shouldFail: true)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        coordinator.startManual(plan: PreDivePlan())

        XCTAssertEqual(donor.callCount, 1)
        XCTAssertEqual(recorder.cancelCallCount, 0)
        assertRecording(coordinator, source: .manual)
    }

    func testDuplicateStartsWhileRecordingDoNothing() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        coordinator.startManual(plan: PreDivePlan(diveMode: .freedive))
        coordinator.startFromActionButton()
        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .scuba)])
        XCTAssertEqual(runtime.startManualCallCount, 1)
        XCTAssertEqual(donor.callCount, 1)
        assertRecording(coordinator, source: .manual)
    }

    func testWaterStateChangesDoNotStopOrReplaceRecording() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)

        coordinator.startManual(plan: PreDivePlan())
        water.latestState = .notSubmerged
        water.latestState = .submerged
        runtime.emit(.didStart)

        XCTAssertEqual(recorder.stopCallCount, 0)
        XCTAssertEqual(recorder.cancelCallCount, 0)
        assertRecording(coordinator, source: .manual)
    }

    func testActionButtonEndRejectsSubmergedUnknownAndTooShortRecordings() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startFromActionButton()

        water.latestState = .submerged
        recorder.elapsedTime = 180
        XCTAssertFalse(coordinator.requestActionButtonEnd())

        water.latestState = .unknown
        XCTAssertFalse(coordinator.requestActionButtonEnd())

        water.latestState = .notSubmerged
        recorder.elapsedTime = 179
        XCTAssertFalse(coordinator.requestActionButtonEnd())

        XCTAssertEqual(runtime.invalidateCallCount, 0)
        XCTAssertEqual(recorder.stopCallCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testActionButtonEndInvalidatesSurfacedRecordingWithoutStoppingRecorderDirectly() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 180)
        let water = FakeWaterStateReader(latestState: .notSubmerged)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startFromActionButton()

        XCTAssertTrue(coordinator.requestActionButtonEnd())

        XCTAssertEqual(runtime.invalidateCallCount, 1)
        XCTAssertEqual(recorder.stopCallCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testRuntimeInvalidationWithSamplesCreatesOneSummaryAfterDuplicateCallbacks() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(recorder.stopCallCount, 1)
        XCTAssertEqual(recorder.cancelCallCount, 0)
        assertSummary(coordinator)
    }

    func testRealRecorderProcessesSampleBeforeInvalidationAndIgnoresLateCallbackAfterCancel() async {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let sensorProvider = RetainingManualDepthSensorProvider()
        let profileStore = CountingProfileRecordingStore()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: FakeActionButtonDonor(calls: calls)
        )
        let acceptedSample = EngineTestFixtures.sample(1, depth: 4)

        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        sensorProvider.emit(acceptedSample)

        XCTAssertTrue(recorder.hasCapturedDepthSample)
        XCTAssertEqual(recorder.currentDepth, acceptedSample.depthMeters, accuracy: 0.001)

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertSummary(coordinator)
        let recordedSampleCount = recorder.samples.count
        let persistedSampleCount = profileStore.appendedSamples.count
        coordinator.discardSummary()

        XCTAssertEqual(profileStore.clearCallCount, 1)
        sensorProvider.emitRetained(EngineTestFixtures.sample(2, depth: 18))
        await Task.yield()

        XCTAssertFalse(recorder.isRecording)
        XCTAssertFalse(recorder.hasCapturedDepthSample)
        XCTAssertEqual(recorder.currentDepth, acceptedSample.depthMeters, accuracy: 0.001)
        XCTAssertEqual(recorder.maxDepth, acceptedSample.depthMeters, accuracy: 0.001)
        XCTAssertEqual(recorder.samples.count, recordedSampleCount)
        XCTAssertEqual(profileStore.appendedSamples.count, persistedSampleCount)
    }

    func testManualAndActionButtonNoSampleInvalidationCancelsAndShowsNoSamples() {
        let manualCalls = LifecycleCallLog()
        let manualRuntime = FakeDiveRuntime(calls: manualCalls)
        let manualRecorder = FakeDiveRecorder(calls: manualCalls)
        let manualCoordinator = makeCoordinator(runtime: manualRuntime, recorder: manualRecorder)
        manualCoordinator.startManual(plan: PreDivePlan())
        manualRuntime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(manualRecorder.cancelCallCount, 1)
        assertNoSamples(manualCoordinator)

        let actionCalls = LifecycleCallLog()
        let actionRuntime = FakeDiveRuntime(calls: actionCalls)
        let actionRecorder = FakeDiveRecorder(calls: actionCalls)
        let actionCoordinator = makeCoordinator(runtime: actionRuntime, recorder: actionRecorder)
        actionCoordinator.startFromActionButton()
        actionRuntime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(actionRecorder.cancelCallCount, 1)
        assertNoSamples(actionCoordinator)
    }

    func testAutomaticNoSampleInvalidationCancelsAndReturnsToIdle() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        runtime.emit(.adoptedSystemSession)

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(recorder.cancelCallCount, 1)
        assertIdle(coordinator)
    }

    func testMissingRecordAfterRuntimeInvalidationCancelsAndShowsNoSamples() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true, stopResult: nil)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(recorder.stopCallCount, 1)
        XCTAssertEqual(recorder.cancelCallCount, 1)
        assertNoSamples(coordinator)
    }

    func testSummaryDiscardClearsActiveArtifactExactlyOnce() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        coordinator.discardSummary()
        coordinator.discardSummary()

        XCTAssertEqual(recorder.cancelCallCount, 1)
        XCTAssertEqual(recorder.resetCompletedSessionCallCount, 0)
        assertIdle(coordinator)
    }

    func testSuccessfulSavePermitsCompletionWhileUnreportedFailureLeavesSummaryActive() throws {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            stopResult: record
        )
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        let failedStore = try makeFailingStore()
        XCTAssertFalse(failedStore.save(record))
        assertSummary(coordinator)

        let successStore = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            recordsStorageURL: makeIsolatedRecordsStorageURL()
        )
        XCTAssertTrue(successStore.save(record))
        coordinator.markSummarySaved()
        coordinator.markSummarySaved()

        XCTAssertEqual(recorder.cancelCallCount, 0)
        XCTAssertEqual(recorder.resetCompletedSessionCallCount, 1)
        assertIdle(coordinator)
    }

    func testNoSamplesCanBeDismissedIdempotently() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        coordinator.dismissNoSamples()
        coordinator.dismissNoSamples()

        assertIdle(coordinator)
    }

    func testStoreSaveReturnsFalseWhenArtifactFinalizationFails() throws {
        let store = try makeFailingStore()

        XCTAssertFalse(store.save(DiveSessionRecord.largeDebugFixture(sampleCount: 1)))
        XCTAssertTrue(store.sessions.isEmpty)
    }

    private func makeFailingStore() throws -> DiveSessionStore {
        let userDefaultsSuite = "RealDiveSessionCoordinatorTests.\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: userDefaultsSuite))
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: false)
        try Data("file-not-directory".utf8).write(to: rootURL)
        addTeardownBlock {
            userDefaults.removePersistentDomain(forName: userDefaultsSuite)
            try? FileManager.default.removeItem(at: rootURL)
        }
        return DiveSessionStore(
            userDefaults: userDefaults,
            recordsStorageURL: rootURL.appendingPathComponent("records.json")
        )
    }

    private func makeIsolatedUserDefaults() -> UserDefaults {
        let suite = "RealDiveSessionCoordinatorTests.\(UUID().uuidString)"
        let userDefaults = UserDefaults(suiteName: suite)!
        addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suite)
        }
        return userDefaults
    }

    private func makeIsolatedRecordsStorageURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: directory)
        }
        return directory.appendingPathComponent("records.json")
    }

    private func makeCoordinator(
        preferredMode: DiveMode = .scuba,
        runtime: FakeDiveRuntime,
        recorder: FakeDiveRecorder,
        water: FakeWaterStateReader? = nil,
        donor: FakeActionButtonDonor? = nil
    ) -> RealDiveSessionCoordinator {
        RealDiveSessionCoordinator(
            preferredMode: { preferredMode },
            runtime: runtime,
            recorder: recorder,
            water: water ?? FakeWaterStateReader(),
            actionButtonDonor: donor ?? FakeActionButtonDonor(calls: LifecycleCallLog())
        )
    }

    private func assertIdle(
        _ coordinator: RealDiveSessionCoordinator,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .idle = coordinator.phase else {
            return XCTFail("Expected idle phase, received \(coordinator.phase)", file: file, line: line)
        }
    }

    private func assertRecording(
        _ coordinator: RealDiveSessionCoordinator,
        source: RealDiveStartSource,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .recording(actualSource) = coordinator.phase else {
            return XCTFail("Expected recording phase, received \(coordinator.phase)", file: file, line: line)
        }
        XCTAssertEqual(actualSource, source, file: file, line: line)
    }

    private func assertSummary(
        _ coordinator: RealDiveSessionCoordinator,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .summary = coordinator.phase else {
            return XCTFail("Expected summary phase, received \(coordinator.phase)", file: file, line: line)
        }
    }

    private func assertNoSamples(
        _ coordinator: RealDiveSessionCoordinator,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .noSamples = coordinator.phase else {
            return XCTFail("Expected no-samples phase, received \(coordinator.phase)", file: file, line: line)
        }
    }
}

@MainActor
private final class LifecycleCallLog {
    private(set) var values: [String] = []

    func append(_ value: String) {
        values.append(value)
    }
}

@MainActor
private final class FakeDiveRuntime: DiveRuntimeSessionControlling {
    var onEvent: ((DiveRuntimeEvent) -> Void)?

    private let calls: LifecycleCallLog
    private(set) var startManualCallCount = 0
    private(set) var invalidateCallCount = 0

    init(calls: LifecycleCallLog) {
        self.calls = calls
    }

    func startManualSession() {
        startManualCallCount += 1
        calls.append("runtime.startManual")
    }

    func adoptSystemSession(_ session: WKExtendedRuntimeSession) {}

    func invalidate() {
        invalidateCallCount += 1
        calls.append("runtime.invalidate")
    }

    func emit(_ event: DiveRuntimeEvent) {
        onEvent?(event)
    }
}

@MainActor
private final class FakeDiveRecorder: DiveSessionRecording {
    var elapsedTime: TimeInterval
    var hasCapturedDepthSample: Bool

    private let calls: LifecycleCallLog
    private let stopResult: DiveSessionRecord?
    private(set) var startedPlans: [PreDivePlan] = []
    private(set) var stopCallCount = 0
    private(set) var cancelCallCount = 0
    private(set) var resetCompletedSessionCallCount = 0

    init(
        calls: LifecycleCallLog,
        elapsedTime: TimeInterval = 0,
        hasCapturedDepthSample: Bool = false,
        stopResult: DiveSessionRecord? = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    ) {
        self.calls = calls
        self.elapsedTime = elapsedTime
        self.hasCapturedDepthSample = hasCapturedDepthSample
        self.stopResult = stopResult
    }

    func startSession(plan: PreDivePlan) {
        startedPlans.append(plan)
        calls.append("recorder.start")
    }

    func stopSession() -> DiveSessionRecord? {
        stopCallCount += 1
        calls.append("recorder.stop")
        return stopResult
    }

    func cancelSession() {
        cancelCallCount += 1
        calls.append("recorder.cancel")
    }

    func resetCompletedSession() {
        resetCompletedSessionCallCount += 1
        calls.append("recorder.resetCompleted")
    }
}

@MainActor
private final class RetainingManualDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)? {
        didSet {
            if let onSample {
                retainedCallback = onSample
            }
        }
    }

    private var retainedCallback: ((DepthSample) -> Void)?

    func start() {}

    func stop() {}

    func emit(_ sample: DepthSample) {
        onSample?(sample)
    }

    func emitRetained(_ sample: DepthSample) {
        retainedCallback?(sample)
    }
}

private final class CountingProfileRecordingStore: DiveProfileRecordingStoring {
    private(set) var appendedSamples: [DepthSample] = []
    private(set) var clearCallCount = 0

    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws {}

    func append(_ sample: DepthSample, to sessionID: UUID) throws {
        appendedSamples.append(sample)
    }

    func clearActiveRecording(sessionID: UUID) throws {
        clearCallCount += 1
    }
}

@MainActor
private final class FakeWaterStateReader: WaterSubmersionStateReading {
    var latestState: WaterSubmersionState

    init(latestState: WaterSubmersionState = .unknown) {
        self.latestState = latestState
    }
}

@MainActor
private final class FakeActionButtonDonor: DiveActionButtonDonating {
    private let calls: LifecycleCallLog
    private let shouldFail: Bool
    private(set) var callCount = 0

    init(calls: LifecycleCallLog, shouldFail: Bool = false) {
        self.calls = calls
        self.shouldFail = shouldFail
    }

    func donateEndAction() {
        callCount += 1
        calls.append(shouldFail ? "donor.failed" : "donor.donated")
    }
}
