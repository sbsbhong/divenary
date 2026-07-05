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
}
