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

@MainActor
final class WatchRecordingModeTests: XCTestCase {
    func testDebugTestUsesDemoCaptureModeForExistingSyncContract() {
        XCTAssertEqual(WatchRecordingMode.debugTest.captureMode, .demo)
    }

    func testRealModeExcludesSimulatedProviderCrownAndTouchEndPolicies() {
        XCTAssertNil(WatchRecordingMode.real.makeSimulatedSensorProvider())
        XCTAssertFalse(WatchRecordingMode.real.controlPolicy.usesCrownDepthControl)
        XCTAssertFalse(WatchRecordingMode.real.controlPolicy.exposesTouchEndControl)
        XCTAssertFalse(WatchRecordingMode.real.controlPolicy.usesSurfaceEndDiveGate)
    }

    func testDemoAndDebugUseDemoProviderCrownAndSurfaceGatedTouchEndPolicies() {
        for mode in [WatchRecordingMode.demo, .debugTest] {
            XCTAssertTrue(mode.makeSimulatedSensorProvider() is DemoDepthSensorProvider)
            XCTAssertTrue(mode.controlPolicy.usesCrownDepthControl)
            XCTAssertTrue(mode.controlPolicy.exposesTouchEndControl)
            XCTAssertTrue(mode.controlPolicy.usesSurfaceEndDiveGate)
        }
    }

    func testDebugTestAddsDurableTestProvenanceWithoutChangingTheSyncContract() {
        let preparedPlan = WatchRecordingMode.debugTest.prepare(plan: PreDivePlan(diveMode: .freedive))

        XCTAssertEqual(WatchRecordingMode.debugTest.captureMode, .demo)
        XCTAssertTrue(preparedPlan.tags.contains(DiveSessionRecord.debugTestTag))
        XCTAssertFalse(WatchRecordingMode.demo.prepare(plan: PreDivePlan()).tags.contains(DiveSessionRecord.debugTestTag))
    }

    func testRealFlowNavigationIsDerivedFromCoordinatorPhase() {
        XCTAssertFalse(RealDivePhase.idle.presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.recording(source: .systemAutoLaunch).presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.summary(DiveSessionRecord.largeDebugFixture(sampleCount: 1)).presentsRecordingFlow)
        XCTAssertTrue(RealDivePhase.noSamples.presentsRecordingFlow)
    }

    func testControlRowReservesRailColumnAndStaysWithinBoundedHeight() {
        XCTAssertEqual(DepthGaugeRail.layoutWidth, 62)
        XCTAssertEqual(
            RecordingControlRowLayout.leadingReservedWidth,
            DepthGaugeRail.layoutWidth + 9
        )
        XCTAssertEqual(RecordingControlRowLayout.minimumHeight, 30)
        XCTAssertEqual(RecordingControlRowLayout.maximumHeight, 36)
    }

    func testSensorDisplayLimitUsesSignedMaximumWithoutExceedingProductBoundary() {
        XCTAssertEqual(RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: nil), 40)
        XCTAssertEqual(RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: 6), 6)
        XCTAssertEqual(RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: 80), 40)
    }
}
