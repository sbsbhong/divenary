import XCTest
@testable import DivenaryWatchApp

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
        hold(&controller, depth: 4.8, from: 3, through: 12)

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
        hold(&controller, depth: 4.8, from: 19, through: 28)

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
    }

    func testCountdownReachingZeroMarksCompleted() {
        var controller = activeController()
        hold(&controller, depth: 5, from: 3, through: 182)

        XCTAssertEqual(controller.record.status, .completed)
        XCTAssertTrue(controller.record.completed)
        XCTAssertEqual(controller.record.remainingSeconds, 0, accuracy: 0.01)
    }

    func testSensorGapCreditsAtMostFiveSecondsOfStopTime() {
        var controller = activeController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(100, depth: 5))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(250, depth: 5))

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertFalse(controller.record.completed)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 10, accuracy: 0.01)
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
    }

    func testFinalCompletionIntervalClampsCreditedTime() {
        var controller = activeController()
        hold(&controller, depth: 5, from: 3, through: 181)
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(184, depth: 5))

        XCTAssertEqual(controller.record.status, .completed)
        XCTAssertEqual(controller.record.remainingSeconds, 0, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 180, accuracy: 0.01)
        XCTAssertEqual(controller.record.completedAt, EngineTestFixtures.date(182))
    }

    func testCompletedStateRemainsCompletedWhileCurrentDepthIsBelowArmDepth() {
        var controller = completedController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(190, depth: 9.9))

        XCTAssertEqual(controller.record.status, .completed)
        XCTAssertTrue(controller.record.completed)
        XCTAssertEqual(controller.record.completedAt, EngineTestFixtures.date(182))
    }

    func testCompletedStateRearmsAtCurrentArmDepth() {
        var controller = completedController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(190, depth: 10))

        XCTAssertEqual(controller.record.status, .armed)
        XCTAssertTrue(controller.record.required)
        XCTAssertFalse(controller.record.completed)
        XCTAssertEqual(controller.record.remainingSeconds, 180, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 0, accuracy: 0.01)
        XCTAssertNil(controller.record.startedAt)
        XCTAssertNil(controller.record.completedAt)
    }

    func testRearmedStopStartsFreshCountdownOnReturningToCountingZone() {
        var controller = completedController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(190, depth: 10))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(200, depth: 5))
        hold(&controller, depth: 5, from: 201, through: 210)

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.startedAt, EngineTestFixtures.date(200))
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 10, accuracy: 0.01)
    }

    func testSurfacingBeforeCompletionMarksIncomplete() {
        var controller = activeController()
        controller.markSurfaced(at: EngineTestFixtures.date(40))

        XCTAssertEqual(controller.record.status, .skippedOrIncomplete)
        XCTAssertFalse(controller.record.completed)
    }

    func testIncompleteStateIsNotResetByLaterBelowArmDepthUpdate() {
        var controller = activeController()
        controller.markSurfaced(at: EngineTestFixtures.date(40))
        controller.update(maxDepthMeters: 9.9, sample: EngineTestFixtures.sample(50, depth: 0))

        XCTAssertEqual(controller.record.status, .skippedOrIncomplete)
        XCTAssertTrue(controller.record.required)
        XCTAssertFalse(controller.record.completed)
    }

    func testArmedStateIsNotResetByLaterBelowArmDepthUpdate() {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 10, sample: EngineTestFixtures.sample(0, depth: 10))
        controller.update(maxDepthMeters: 9.9, sample: EngineTestFixtures.sample(1, depth: 0))

        XCTAssertEqual(controller.record.status, .armed)
        XCTAssertTrue(controller.record.required)
    }

    func testCountingZoneBoundariesAreIncluded() {
        var controller = SafetyStopController()
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(0, depth: 12))
        controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(2, depth: 2.7))
        hold(&controller, depth: 6.3, from: 3, through: 12)

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
    }

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
        hold(&controller, depth: 5, from: 56, through: 65)

        XCTAssertEqual(controller.record.status, .active)
        XCTAssertEqual(controller.record.startedAt, EngineTestFixtures.date(55))
        XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
        XCTAssertEqual(controller.record.timeInZoneSeconds, 10, accuracy: 0.01)
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

    private func activeControllerWithTenSecondsCredited() -> SafetyStopController {
        var controller = activeController()
        hold(&controller, depth: 5, from: 3, through: 12)
        return controller
    }

    private func completedController() -> SafetyStopController {
        var controller = activeController()
        hold(&controller, depth: 5, from: 3, through: 182)
        return controller
    }

    private func hold(
        _ controller: inout SafetyStopController,
        depth: Double,
        from start: TimeInterval,
        through end: TimeInterval
    ) {
        for sample in EngineTestFixtures.samples(from: start, through: end, depth: depth) {
            controller.update(maxDepthMeters: 12, sample: sample)
        }
    }
}
