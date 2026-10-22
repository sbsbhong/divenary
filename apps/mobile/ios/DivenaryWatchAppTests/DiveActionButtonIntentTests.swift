import XCTest
@testable import DivenaryWatchApp

@MainActor
final class DiveActionButtonIntentTests: XCTestCase {
    func testBridgeForwardsEachPressToTheCoordinatorOnce() {
        let coordinator = FakeRealDiveActionController(outcomes: [.started, .pageChanged(.details)])
        let bridge = DiveActionButtonBridge(controller: coordinator)

        XCTAssertEqual(bridge.performDiveAction(), .started)
        XCTAssertEqual(bridge.performDiveAction(), .pageChanged(.details))

        XCTAssertEqual(coordinator.pressCount, 2)
    }

    func testBridgeReturnsTheCoordinatorsRejection() {
        let coordinator = FakeRealDiveActionController(outcomes: [.rejected(.startFailed)])
        let bridge = DiveActionButtonBridge(controller: coordinator)

        XCTAssertEqual(bridge.performDiveAction(), .rejected(.startFailed))
        XCTAssertEqual(coordinator.pressCount, 1)
    }

    func testBridgeRoutesPressesToActiveDemoOverrideBeforeRealCoordinator() {
        let coordinator = FakeRealDiveActionController(outcomes: [.pageChanged(.details)])
        let bridge = DiveActionButtonBridge(controller: coordinator)
        var overrideResults = [true, false]
        var overrideCallCount = 0

        let token = bridge.installEndOverride {
            overrideCallCount += 1
            return overrideResults.removeFirst()
        }

        XCTAssertEqual(bridge.performDiveAction(), .endRequested)
        XCTAssertEqual(bridge.performDiveAction(), .rejected(.endUnavailable))
        XCTAssertEqual(overrideCallCount, 2)
        XCTAssertEqual(coordinator.pressCount, 0)

        bridge.removeEndOverride(token)
        XCTAssertEqual(bridge.performDiveAction(), .pageChanged(.details))
        XCTAssertEqual(coordinator.pressCount, 1)
    }

    func testRemovingAStaleOverrideTokenKeepsTheCurrentOverride() {
        let coordinator = FakeRealDiveActionController(outcomes: [.pageChanged(.details)])
        let bridge = DiveActionButtonBridge(controller: coordinator)
        let staleToken = bridge.installEndOverride { false }
        _ = bridge.installEndOverride { true }

        bridge.removeEndOverride(staleToken)

        XCTAssertEqual(bridge.performDiveAction(), .endRequested)
        XCTAssertEqual(coordinator.pressCount, 0)
    }

    func testStartIntentRunsThePhaseAwarePressOnce() async throws {
        let coordinator = FakeRealDiveActionController(outcomes: [.started])
        let intent = DivenaryStartDiveIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.pressCount, 1)
    }

    func testDiveActionIntentRunsThePhaseAwarePressOnce() async throws {
        let coordinator = FakeRealDiveActionController(outcomes: [.pageChanged(.details)])
        let intent = DivenaryDiveActionIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.pressCount, 1)
    }

    func testDiveActionIntentForwardsAnEndPressOnce() async throws {
        let coordinator = FakeRealDiveActionController(outcomes: [.endRequested])
        let intent = DivenaryDiveActionIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.pressCount, 1)
    }

    func testDiveActionStaysOnTheButtonUntilAPressEndsTheDive() {
        let keepingOutcomes: [DiveActionOutcome] = [
            .started,
            .pageChanged(.live),
            .pageChanged(.details),
            .pageChanged(.end),
            .rejected(.busy),
            .rejected(.startFailed),
            .rejected(.endUnavailable),
        ]

        for outcome in keepingOutcomes {
            XCTAssertTrue(outcome.keepsDiveActionOnButton, "\(outcome)")
        }
        XCTAssertFalse(DiveActionOutcome.endRequested.keepsDiveActionOnButton)
    }

    func testDonorInvokesInjectedDonationOperationOnce() async {
        let invoked = expectation(description: "donation operation invoked")
        let recorder = DonationOperationRecorder()
        let donor = DiveActionButtonDonor {
            recorder.recordInvocation()
            invoked.fulfill()
        }

        donor.donateDiveAction()

        await fulfillment(of: [invoked], timeout: 1)
        XCTAssertEqual(recorder.callCount, 1)
    }

    func testDonorCatchesInjectedDonationFailureWithoutEscaping() async {
        let invoked = expectation(description: "donation operation invoked")
        let failureObserved = expectation(description: "donation failure observed")
        let recorder = DonationOperationRecorder()
        let donor = DiveActionButtonDonor(
            donationOperation: {
                recorder.recordInvocation()
                invoked.fulfill()
                throw TestDonationError.expected
            },
            onDonationFailure: { error in
                XCTAssertEqual(error as? TestDonationError, .expected)
                failureObserved.fulfill()
            }
        )

        donor.donateDiveAction()

        await fulfillment(of: [invoked, failureObserved], timeout: 1)
        XCTAssertEqual(recorder.callCount, 1)
    }
}

@MainActor
private final class FakeRealDiveActionController: RealDiveActionControlling {
    private(set) var pressCount = 0
    private var outcomes: [DiveActionOutcome]

    init(outcomes: [DiveActionOutcome]) {
        self.outcomes = outcomes
    }

    func handleActionButtonPress() -> DiveActionOutcome {
        pressCount += 1
        return outcomes.isEmpty ? .rejected(.busy) : outcomes.removeFirst()
    }
}

@MainActor
private final class DonationOperationRecorder {
    private(set) var callCount = 0

    func recordInvocation() {
        callCount += 1
    }
}

private enum TestDonationError: Error, Equatable {
    case expected
}
