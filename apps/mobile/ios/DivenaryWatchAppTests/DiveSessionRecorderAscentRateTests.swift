import XCTest
@testable import DivenaryWatchApp

final class DiveSessionRecorderAscentRateTests: XCTestCase {
    @MainActor
    func testBeginRecordingFailureKeepsCaptureStoppedAndCancellationCoherent() {
        let sensor = ManualDepthSensorProvider()
        let profileStore = FailingBeginProfileRecordingStore()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensor,
            captureMode: .demo,
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertFalse(recorder.isRecording)
        XCTAssertFalse(recorder.hasCapturedDepthSample)
        XCTAssertEqual(sensor.startCount, 0)
        XCTAssertEqual(sensor.stopCount, 0)
        XCTAssertNotNil(recorder.recordingPersistenceError)
        XCTAssertTrue(recorder.cancelSession())
        XCTAssertEqual(profileStore.clearCallCount, 0)
    }

    @MainActor
    func testLaterSuccessfulAppendClearsObservablePersistenceErrorAfterPendingRecovery() async throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileManager = FailFirstRecorderPendingRemovalFileManager()
        let profileStore = DiveProfileArtifactStore(rootURL: rootURL, fileManager: fileManager)
        let sensor = ManualDepthSensorProvider()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensor,
            captureMode: .demo,
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )

        XCTAssertTrue(recorder.startSession(plan: PreDivePlan(diveMode: .scuba)))
        sensor.emit(sample(at: 0.1, depth: 2))
        sensor.emit(sample(at: 1.2, depth: 4))
        await Task.yield()
        XCTAssertNotNil(recorder.recordingPersistenceError)

        sensor.emit(sample(at: 2.2, depth: 6))
        await Task.yield()

        XCTAssertNil(recorder.recordingPersistenceError)
        XCTAssertEqual(try profileStore.loadActiveRecordings().first?.samples.count, 2)
        XCTAssertTrue(recorder.cancelSession())
    }

    @MainActor
    func testRapidCallbackJitterDoesNotCreateLiveAscentRateOrWarning() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 10.00))
        sensor.emit(sample(at: 1, depth: 9.94))
        sensor.emit(sample(at: 2, depth: 10.03))
        sensor.emit(sample(at: 3, depth: 9.90))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testQualifyingThreeSecondNetAscentUpdatesLiveRate() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 1, depth: 11.9))
        sensor.emit(sample(at: 2, depth: 11.7))
        sensor.emit(sample(at: 3, depth: 11.7))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 6, accuracy: 0.001)
        XCTAssertFalse(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testNineMetersPerMinuteSmoothedResultDoesNotWarn() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 1, depth: 11.9))
        sensor.emit(sample(at: 2, depth: 11.55))
        sensor.emit(sample(at: 3, depth: 11.55))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 9, accuracy: 0.001)
        XCTAssertFalse(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testRateAboveNineMetersPerMinuteSetsExistingWarningFlag() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 1, depth: 11.9))
        sensor.emit(sample(at: 2, depth: 11.4))
        sensor.emit(sample(at: 3, depth: 11.4))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 12, accuracy: 0.001)
        XCTAssertTrue(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testFlatOrDeeperQualifyingWindowClearsLiveRateAndWarning() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 3, depth: 11.4))
        await Task.yield()
        XCTAssertTrue(recorder.ascentWarningActive)

        sensor.emit(sample(at: 6, depth: 11.4))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)

        sensor.emit(sample(at: 9, depth: 12.0))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testCancelThenRestartRequiresFreshThreeSecondWindow() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 3, depth: 11.4))
        await Task.yield()
        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 12, accuracy: 0.001)
        XCTAssertTrue(recorder.cancelSession())
        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 4, depth: 10.0))
        sensor.emit(sample(at: 5, depth: 9.0))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testResetCompletedSessionClearsLiveAscentState() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 3, depth: 11.4))
        await Task.yield()
        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 12, accuracy: 0.001)
        XCTAssertTrue(recorder.ascentWarningActive)

        _ = recorder.stopSession()
        recorder.resetCompletedSession()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)
    }

    @MainActor
    func testRejectedCallbacksKeepZeroDisplayBeforeWindowAndDoNotPoisonRecovery() async {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 1, depth: 12.0))
        sensor.emit(sample(at: 1, depth: 0.0))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)

        sensor.emit(sample(at: 2, depth: .nan))
        sensor.emit(sample(at: 2.5, depth: .infinity))
        sensor.emit(sample(at: 0, depth: 0.0))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 0)
        XCTAssertFalse(recorder.ascentWarningActive)

        sensor.emit(sample(at: 4, depth: 11.4))
        await Task.yield()

        XCTAssertEqual(recorder.latestAscentRateMetersPerMinute, 12, accuracy: 0.001)
        XCTAssertTrue(recorder.ascentWarningActive)
        recorder.cancelSession()
    }

    @MainActor
    func testMultipleRawCallbacksPerSecondPreserveOneHertzArtifactsAndExtrema() async throws {
        let sensor = ManualDepthSensorProvider()
        let profileStore = StubProfileRecordingStore()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensor,
            captureMode: .demo,
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0.1, depth: 2, temperature: 21))
        sensor.emit(sample(at: 0.8, depth: 7, temperature: nil))
        sensor.emit(sample(at: 1.2, depth: 4, temperature: 22))
        await Task.yield()

        let record = try XCTUnwrap(recorder.stopSession())

        XCTAssertEqual(record.samples.count, 2)
        XCTAssertEqual(record.samples.map(\.depthMeters), [7, 4])
        XCTAssertEqual(record.samples.first?.bucketMinDepthMeters, 2)
        XCTAssertEqual(record.samples.first?.bucketMaxDepthMeters, 7)
        XCTAssertEqual(profileStore.appendedSamples.map(\.depthMeters), [7, 4])
        recorder.cancelSession()
    }

    @MainActor
    func testStoppingScubaSessionPreservesEngineAscentFields() async throws {
        let sensor = ManualDepthSensorProvider()
        let recorder = makeRecorder(sensor: sensor)

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensor.emit(sample(at: 0, depth: 12.0))
        sensor.emit(sample(at: 1, depth: 11.9))
        sensor.emit(sample(at: 2, depth: 11.4))
        sensor.emit(sample(at: 3, depth: 11.4))
        await Task.yield()

        let record = try XCTUnwrap(recorder.stopSession())
        guard case let .scuba(session) = record.payload else {
            return XCTFail("Expected a scuba session payload")
        }

        XCTAssertEqual(session.latestAscentRateMetersPerMinute, 0, accuracy: 0.001)
        XCTAssertEqual(session.maxAscentRateMetersPerMinute, 30, accuracy: 0.001)
        recorder.cancelSession()
    }

    @MainActor
    private func makeRecorder(sensor: ManualDepthSensorProvider) -> DiveSessionRecorder {
        DiveSessionRecorder(
            sensorProvider: sensor,
            captureMode: .demo,
            profileStore: StubProfileRecordingStore(),
            now: { EngineTestFixtures.start }
        )
    }

    private func sample(
        at seconds: TimeInterval,
        depth: Double,
        temperature: Double? = 24
    ) -> DepthSample {
        EngineTestFixtures.sample(seconds, depth: depth, temperature: temperature)
    }
}

@MainActor
private final class ManualDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?
    private(set) var startCount = 0
    private(set) var stopCount = 0

    func start() {
        startCount += 1
    }

    func stop() {
        stopCount += 1
    }

    func emit(_ sample: DepthSample) {
        onSample?(sample)
    }
}

private final class FailingBeginProfileRecordingStore: DiveProfileRecordingStoring {
    private(set) var clearCallCount = 0

    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws {
        throw CocoaError(.fileWriteNoPermission)
    }

    func append(_ sample: DepthSample, to sessionID: UUID) throws {}

    func clearActiveRecording(sessionID: UUID) throws {
        clearCallCount += 1
    }
}

private final class FailFirstRecorderPendingRemovalFileManager: FileManager {
    private var didFailPendingRemoval = false

    override func removeItem(at URL: URL) throws {
        if !didFailPendingRemoval, URL.lastPathComponent == "recording-pending.json" {
            didFailPendingRemoval = true
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.removeItem(at: URL)
    }
}

private final class StubProfileRecordingStore: DiveProfileRecordingStoring {
    private(set) var appendedSamples: [DepthSample] = []

    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws {}

    func append(_ sample: DepthSample, to sessionID: UUID) throws {
        appendedSamples.append(sample)
    }

    func clearActiveRecording(sessionID: UUID) throws {}
}
