import XCTest
@testable import DivenaryWatchApp

final class ScubaDiveEngineTests: XCTestCase {
    func testRepeatedFinishReturnsSameSessionID() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: "Air")
        engine.append(EngineTestFixtures.sample(0, depth: 0))
        engine.append(EngineTestFixtures.sample(60, depth: 12))

        let first = engine.finish(at: EngineTestFixtures.date(120))
        let second = engine.finish(at: EngineTestFixtures.date(180))

        XCTAssertEqual(first.id, second.id)
    }

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

    func testEngineTracksDepthTemperatureAndAscentRates() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: "Nitrox 32")
        engine.append(EngineTestFixtures.sample(0, depth: 0, temperature: 20))
        engine.append(EngineTestFixtures.sample(60, depth: 12, temperature: 22))
        engine.append(EngineTestFixtures.sample(120, depth: 6, temperature: 24))
        engine.append(EngineTestFixtures.sample(180, depth: 3, temperature: 26))

        let session = engine.finish(at: EngineTestFixtures.date(240))

        XCTAssertEqual(engine.currentDepthMeters, 3)
        XCTAssertEqual(session.averageDepthMeters, 5.25)
        XCTAssertEqual(session.waterTemperatureCelsius, 23)
        XCTAssertEqual(session.latestAscentRateMetersPerMinute, 3)
        XCTAssertEqual(session.maxAscentRateMetersPerMinute, 6)
    }

    func testEngineAveragesOnlyAvailableTemperatures() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: "Air")
        engine.append(EngineTestFixtures.sample(0, depth: 0, temperature: nil))
        engine.append(EngineTestFixtures.sample(60, depth: 12, temperature: 22))
        engine.append(EngineTestFixtures.sample(120, depth: 6, temperature: nil))
        engine.append(EngineTestFixtures.sample(180, depth: 3, temperature: 24))

        let session = engine.finish(at: EngineTestFixtures.date(240))

        XCTAssertEqual(session.waterTemperatureCelsius, 23)
    }

    func testSampleWithoutTemperatureRemainsValidForRecording() {
        let sample = EngineTestFixtures.sample(0, depth: 1.2, temperature: nil)

        XCTAssertTrue(sample.isValidRecordingSample)
    }

    func testSampleWithoutTemperatureOmitsTemperatureFromJSON() throws {
        let sample = EngineTestFixtures.sample(0, depth: 1.2, temperature: nil)

        let data = try JSONEncoder().encode(sample)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertNil(object["waterTemperatureCelsius"])
        XCTAssertEqual(object["depthMeters"] as? Double, 1.2)
    }

    func testFinishMarksSurfacedRequiredStopIncomplete() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: nil)
        engine.append(EngineTestFixtures.sample(0, depth: 0))
        engine.append(EngineTestFixtures.sample(60, depth: 20))
        engine.append(EngineTestFixtures.sample(120, depth: 0.4))

        let session = engine.finish(at: EngineTestFixtures.date(150))

        XCTAssertEqual(session.safetyStop.status, .skippedOrIncomplete)
        XCTAssertTrue(session.safetyStop.required)
        XCTAssertFalse(session.safetyStop.completed)
    }

    func testShallowFinishDoesNotRequireSafetyStop() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: nil)
        engine.append(EngineTestFixtures.sample(0, depth: 0))
        engine.append(EngineTestFixtures.sample(60, depth: 4))
        engine.append(EngineTestFixtures.sample(120, depth: 0.4))

        let session = engine.finish(at: EngineTestFixtures.date(150))

        XCTAssertEqual(session.safetyStop.status, .notRequired)
        XCTAssertFalse(session.safetyStop.required)
        XCTAssertFalse(session.safetyStop.completed)
    }

    func testCompletedStopFollowedBySurfacedFinishStaysCompleted() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: nil)
        engine.append(EngineTestFixtures.sample(0, depth: 0))
        engine.append(EngineTestFixtures.sample(60, depth: 18))
        engine.append(EngineTestFixtures.sample(120, depth: 5))
        engine.append(EngineTestFixtures.sample(300, depth: 5))
        engine.append(EngineTestFixtures.sample(360, depth: 0.4))

        let session = engine.finish(at: EngineTestFixtures.date(420))

        XCTAssertEqual(session.safetyStop.status, .completed)
        XCTAssertTrue(session.safetyStop.required)
        XCTAssertTrue(session.safetyStop.completed)
    }

    func testNoSamplesFinishReturnsEmptySummaryAndNoRequiredStop() {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: nil)

        let session = engine.finish(at: EngineTestFixtures.date(60))

        XCTAssertEqual(session.maxDepthMeters, 0)
        XCTAssertEqual(session.averageDepthMeters, 0)
        XCTAssertNil(session.waterTemperatureCelsius)
        XCTAssertEqual(session.safetyStop.status, .notRequired)
        XCTAssertFalse(session.safetyStop.required)
        XCTAssertFalse(session.safetyStop.completed)
    }

    func testEngineIgnoresNonFiniteSamplesBeforeAverages() throws {
        var engine = ScubaDiveEngine(startedAt: EngineTestFixtures.start, gasLabel: "Air")
        engine.append(EngineTestFixtures.sample(0, depth: 0))
        engine.append(EngineTestFixtures.sample(60, depth: .nan))
        engine.append(EngineTestFixtures.sample(120, depth: 0.4))
        let session = engine.finish(at: EngineTestFixtures.date(180))

        XCTAssertEqual(session.maxDepthMeters, 0.4)
        XCTAssertEqual(session.averageDepthMeters, 0.2)
        XCTAssertNoThrow(try JSONEncoder().encode(session))
    }
}

final class DepthSensorAvailabilityTests: XCTestCase {
    func testSimulatorWithoutWaterSubmersionRequiresRealWatchAndDisablesRealDiveSelection() {
        let availability = DepthSensorAvailability(
            isWaterSubmersionAvailable: false,
            authorizationStatusDescription: "notDetermined",
            waterResistanceDescription: "unknown",
            isRunningInSimulator: true
        )

        XCTAssertEqual(availability.readiness, .simulatorRequiresRealWatch)
        XCTAssertFalse(availability.canStartRealDive)
        XCTAssertFalse(availability.canSelectPlannedDives)
    }

    func testUnsupportedDeviceDisablesRealDiveSelection() {
        let availability = DepthSensorAvailability(
            isWaterSubmersionAvailable: false,
            authorizationStatusDescription: "notDetermined",
            waterResistanceDescription: "unknown",
            isRunningInSimulator: false
        )

        XCTAssertEqual(availability.readiness, .unsupportedDevice)
        XCTAssertFalse(availability.canStartRealDive)
        XCTAssertFalse(availability.canSelectPlannedDives)
    }

    func testSupportedSensorAllowsManualRealDiveStartBeforeSubmersion() {
        let availability = DepthSensorAvailability(
            isWaterSubmersionAvailable: true,
            authorizationStatusDescription: "authorized",
            waterResistanceDescription: "wr100",
            isRunningInSimulator: false
        )

        XCTAssertEqual(availability.readiness, .ready)
        XCTAssertTrue(availability.canStartRealDive)
        XCTAssertTrue(availability.canSelectPlannedDives)
    }
}

@MainActor
final class WatchRecordingModeTests: XCTestCase {
    func testDebugTestUsesDemoCaptureModeForExistingSyncContract() {
        XCTAssertEqual(WatchRecordingMode.debugTest.captureMode, .demo)
    }

    func testRealModeCannotBuildDemoProviderAndDoesNotUseCrown() {
        XCTAssertNil(WatchRecordingMode.real.makeSimulatedSensorProvider())
        XCTAssertFalse(WatchRecordingMode.real.controlPolicy.usesCrownDepthControl)
    }

    func testDemoAndDebugBuildDemoProviderAndUseCrown() {
        for mode in [WatchRecordingMode.demo, .debugTest] {
            XCTAssertTrue(mode.makeSimulatedSensorProvider() is DemoDepthSensorProvider)
            XCTAssertTrue(mode.controlPolicy.usesCrownDepthControl)
        }
    }

    func testRecordingEndControlsMatchSessionType() {
        XCTAssertEqual(WatchRecordingMode.real.endControl, .crownHint)
        XCTAssertEqual(WatchRecordingMode.demo.endControl, .demoButton)
        XCTAssertEqual(WatchRecordingMode.debugTest.endControl, .hidden)
    }

    func testDebugTestAddsDurableTestProvenanceWithoutChangingTheSyncContract() {
        let preparedPlan = WatchRecordingMode.debugTest.prepare(plan: PreDivePlan(diveMode: .freedive))

        XCTAssertEqual(WatchRecordingMode.debugTest.captureMode, .demo)
        XCTAssertTrue(preparedPlan.tags.contains(DiveSessionRecord.debugTestTag))
        XCTAssertFalse(WatchRecordingMode.demo.prepare(plan: PreDivePlan()).tags.contains(DiveSessionRecord.debugTestTag))
    }

    func testRealFlowNavigationIsDerivedFromCoordinatorPhase() {
        XCTAssertFalse(RealDivePhase.idle.presentsRecordingFlow)
        XCTAssertTrue(
            RealDivePhase.recording(
                source: .systemAutoLaunch,
                plan: PreDivePlan(diveMode: .scuba)
            ).presentsRecordingFlow
        )
        XCTAssertTrue(RealDivePhase.completing(record: DiveSessionRecord.largeDebugFixture(sampleCount: 1)).presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.savedSummary(record: DiveSessionRecord.largeDebugFixture(sampleCount: 1)).presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.noSamples.presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.awaitingRuntimeInvalidation(source: .systemAutoLaunch).presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.startPersistenceError(source: .manual).presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.savePersistenceError(record: DiveSessionRecord.largeDebugFixture(sampleCount: 1)).presentsRecordingFlow)
    }

    func testDepthGaugeRailUsesReadableSessionLayoutWidth() {
        XCTAssertEqual(DepthGaugeRail.layoutWidth, 72)
    }

    func testSensorDisplayLimitUsesSignedMaximumWithoutExceedingProductBoundary() {
        XCTAssertEqual(RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: nil), 40)
        XCTAssertEqual(RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: 6), 6)
        XCTAssertEqual(RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: 80), 40)
    }
}

@MainActor
final class SimulatedRecordingLifecycleControllerTests: XCTestCase {
    func testRecorderStartFailureDoesNotEnterFalseRecordingPhase() {
        let (controller, recorder, _) = makeSystem(startResults: [false, true])

        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertEqual(recorder.startCount, 1)
        assertPersistenceError(controller.phase)
        XCTAssertTrue(controller.retryStart(plan: PreDivePlan(diveMode: .scuba)))
        XCTAssertEqual(recorder.startCount, 2)
        assertRecording(controller.phase)
    }

    func testRecorderStartFailureCanBeDismissedWithoutCleanupSuccessClaim() {
        let (controller, recorder, _) = makeSystem(startResults: [false])
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertTrue(controller.dismissPersistenceError())

        XCTAssertEqual(recorder.cancelCount, 0)
        assertCompleted(controller.phase)
    }

    func testRepeatedFlowAppearanceStartsRecorderOnce() {
        let (controller, recorder, _) = makeSystem()

        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertEqual(recorder.startCount, 1)
        assertRecording(controller.phase)
    }

    func testFinishingToSummaryDoesNotCancelOrStartAgain() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, _) = makeSystem(session: session)
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertTrue(controller.finishRecording())
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertEqual(recorder.stopCount, 1)
        XCTAssertEqual(recorder.cancelCount, 0)
        XCTAssertEqual(recorder.startCount, 1)
        assertSummary(controller.phase, sessionID: session.id)
    }

    func testFinishRecordingRejectsEndWhenNotRecording() {
        let (controller, recorder, _) = makeSystem()

        XCTAssertFalse(controller.finishRecording())

        XCTAssertEqual(recorder.stopCount, 0)
        assertReady(controller.phase)
    }

    func testSummaryBackNavigationStaysManagedUntilDiscardCleanupSucceeds() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, _) = makeSystem(
            session: session,
            cancelResults: [false, false, true]
        )

        XCTAssertFalse(controller.hidesSystemBackButton)
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.hidesSystemBackButton)
        XCTAssertTrue(controller.finishRecording())
        XCTAssertTrue(controller.hidesSystemBackButton)

        controller.handleFlowDisappearance()

        XCTAssertFalse(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
        XCTAssertTrue(controller.hidesSystemBackButton)
        assertSummary(controller.phase, sessionID: session.id)
        XCTAssertFalse(controller.discardSummary())
        XCTAssertTrue(controller.hidesSystemBackButton)

        XCTAssertTrue(controller.discardSummary())
        XCTAssertEqual(recorder.cancelCount, 3)
        XCTAssertFalse(controller.hidesSystemBackButton)
        assertCompleted(controller.phase)
        XCTAssertTrue(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
    }

    func testCleanupErrorKeepsBackManagedUntilExternalCleanupRetrySucceeds() {
        let (controller, recorder, _) = makeSystem(cancelResults: [false, false, true])
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        controller.handleFlowDisappearance()

        XCTAssertTrue(controller.hidesSystemBackButton)
        XCTAssertFalse(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
        XCTAssertFalse(controller.retryExternalCleanup())
        XCTAssertTrue(controller.hidesSystemBackButton)

        XCTAssertTrue(controller.retryExternalCleanup())
        XCTAssertEqual(recorder.cancelCount, 3)
        XCTAssertFalse(controller.hidesSystemBackButton)
        assertCompleted(controller.phase)
        XCTAssertTrue(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
    }

    func testUnfinishedExternalDisappearanceCancelsExactlyOnce() {
        let (controller, recorder, _) = makeSystem()
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        controller.handleFlowDisappearance()
        controller.handleFlowDisappearance()

        XCTAssertEqual(recorder.cancelCount, 1)
        assertCompleted(controller.phase)
        XCTAssertTrue(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
    }

    func testSummaryExternalCleanupRequestsDismissalWhenRouteReappears() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, _) = makeSystem(session: session)
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.finishRecording())

        controller.handleFlowDisappearance()

        XCTAssertEqual(recorder.cancelCount, 1)
        assertCompleted(controller.phase)
        XCTAssertTrue(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
    }

    func testSummaryExternalCleanupFailureDoesNotDismissAndLaterRetrySucceeds() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, _) = makeSystem(
            session: session,
            cancelResults: [false, true]
        )
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.finishRecording())

        controller.handleFlowDisappearance()

        XCTAssertFalse(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
        assertSummary(controller.phase, sessionID: session.id)
        XCTAssertTrue(controller.discardSummary())
        XCTAssertEqual(recorder.cancelCount, 2)
        assertCompleted(controller.phase)
    }

    func testRecordingExternalCleanupFailureExposesRetryAndDismissesOnlyAfterSuccess() {
        let (controller, recorder, _) = makeSystem(cancelResults: [false, true])
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        controller.handleFlowDisappearance()

        XCTAssertFalse(controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba)))
        XCTAssertTrue(controller.retryExternalCleanup())
        XCTAssertEqual(recorder.cancelCount, 2)
        assertCompleted(controller.phase)
    }

    func testDemoAndDebugPlansUseSameExternalCleanupDismissalPolicy() {
        for mode in [WatchRecordingMode.demo, .debugTest] {
            let (controller, _, _) = makeSystem()
            let plan = mode.prepare(plan: PreDivePlan(diveMode: .scuba))
            XCTAssertFalse(controller.handleFlowAppearance(plan: plan))
            controller.handleFlowDisappearance()
            XCTAssertTrue(controller.handleFlowAppearance(plan: plan))
        }
    }

    func testSuccessfulSaveCompletesBeforeDismissalAndCannotRestart() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, store) = makeSystem(session: session)
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.finishRecording())

        XCTAssertTrue(controller.saveSummary(session))
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertEqual(store.saveCount, 1)
        XCTAssertEqual(recorder.resetCount, 1)
        XCTAssertEqual(recorder.startCount, 1)
        assertCompleted(controller.phase)
    }

    func testSuccessfulDiscardCompletesAndCannotRestart() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, _) = makeSystem(session: session)
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.finishRecording())

        XCTAssertTrue(controller.discardSummary())
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

        XCTAssertEqual(recorder.cancelCount, 1)
        XCTAssertEqual(recorder.startCount, 1)
        assertCompleted(controller.phase)
    }

    func testFailedSaveKeepsSummaryAndArtifactForRetry() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, store) = makeSystem(
            session: session,
            saveResults: [false, true]
        )
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.finishRecording())

        XCTAssertFalse(controller.saveSummary(session))
        assertSummary(controller.phase, sessionID: session.id)
        XCTAssertTrue(controller.hidesSystemBackButton)
        XCTAssertEqual(recorder.resetCount, 0)
        XCTAssertEqual(recorder.cancelCount, 0)

        XCTAssertTrue(controller.saveSummary(session))
        XCTAssertEqual(store.saveCount, 2)
        XCTAssertEqual(recorder.resetCount, 1)
        XCTAssertFalse(controller.hidesSystemBackButton)
        assertCompleted(controller.phase)
    }

    func testFailedCleanupKeepsSummaryRetryable() {
        let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let (controller, recorder, _) = makeSystem(
            session: session,
            cancelResults: [false, true]
        )
        controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
        XCTAssertTrue(controller.finishRecording())

        XCTAssertFalse(controller.discardSummary())
        XCTAssertEqual(recorder.cancelCount, 1)
        assertSummary(controller.phase, sessionID: session.id)

        XCTAssertTrue(controller.discardSummary())
        XCTAssertEqual(recorder.cancelCount, 2)
        assertCompleted(controller.phase)
    }

    private func assertRecording(
        _ phase: SimulatedRecordingLifecyclePhase,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .recording = phase else {
            return XCTFail("Expected recording phase", file: file, line: line)
        }
    }

    private func assertReady(
        _ phase: SimulatedRecordingLifecyclePhase,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .ready = phase else {
            return XCTFail("Expected ready phase", file: file, line: line)
        }
    }

    private func assertSummary(
        _ phase: SimulatedRecordingLifecyclePhase,
        sessionID: UUID,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .summary(let session) = phase else {
            return XCTFail("Expected summary phase", file: file, line: line)
        }
        XCTAssertEqual(session.id, sessionID, file: file, line: line)
    }

    private func assertCompleted(
        _ phase: SimulatedRecordingLifecyclePhase,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .completed = phase else {
            return XCTFail("Expected completed phase", file: file, line: line)
        }
    }

    private func assertPersistenceError(
        _ phase: SimulatedRecordingLifecyclePhase,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .persistenceError = phase else {
            return XCTFail("Expected persistence-error phase", file: file, line: line)
        }
    }

    private func makeSystem(
        session: DiveSessionRecord = .largeDebugFixture(sampleCount: 1),
        startResults: [Bool] = [true],
        cancelResults: [Bool] = [true],
        saveResults: [Bool] = [true]
    ) -> (
        SimulatedRecordingLifecycleController,
        RecordingSimulatedLifecycleRecorder,
        RecordingSimulatedSessionStore
    ) {
        let recorder = RecordingSimulatedLifecycleRecorder(
            session: session,
            startResults: startResults,
            cancelResults: cancelResults
        )
        let store = RecordingSimulatedSessionStore(saveResults: saveResults)
        return (
            SimulatedRecordingLifecycleController(recorder: recorder, store: store),
            recorder,
            store
        )
    }
}

@MainActor
private final class RecordingSimulatedLifecycleRecorder: SimulatedRecordingLifecycleRecording {
    private let session: DiveSessionRecord
    private var startResults: [Bool]
    private var cancelResults: [Bool]

    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var cancelCount = 0
    private(set) var resetCount = 0

    init(session: DiveSessionRecord, startResults: [Bool], cancelResults: [Bool]) {
        self.session = session
        self.startResults = startResults
        self.cancelResults = cancelResults
    }

    func startSession(plan: PreDivePlan) -> Bool {
        startCount += 1
        return startResults.isEmpty ? true : startResults.removeFirst()
    }

    func stopSession() -> DiveSessionRecord? {
        stopCount += 1
        return session
    }

    func cancelSession() -> Bool {
        cancelCount += 1
        return cancelResults.isEmpty ? true : cancelResults.removeFirst()
    }

    func resetCompletedSession() {
        resetCount += 1
    }
}

@MainActor
private final class RecordingSimulatedSessionStore: SimulatedRecordingSessionStoring {
    private var saveResults: [Bool]
    private(set) var saveCount = 0

    init(saveResults: [Bool]) {
        self.saveResults = saveResults
    }

    func save(_ session: DiveSessionRecord) -> Bool {
        saveCount += 1
        return saveResults.isEmpty ? true : saveResults.removeFirst()
    }
}
