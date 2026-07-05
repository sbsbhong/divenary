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

        XCTAssertFalse(joined.localizedCaseInsensitiveContains("safe to " + "ascend"))
        XCTAssertFalse(joined.contains("상승" + " 가능"))
        XCTAssertFalse(joined.contains("이제 " + "안전합니다"))
        XCTAssertFalse(joined.contains("감압 " + "완료"))
    }

    private func activeController() -> SafetyStopController {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(0, depth: 12))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(2, depth: 5))
        return controller
    }
}
