import XCTest
@testable import DivenaryWatchApp

@MainActor
final class DiveActionButtonIntentTests: XCTestCase {
    func testBridgeStartsFromActionButtonOnce() {
        let coordinator = FakeRealDiveActionController()
        let bridge = DiveActionButtonBridge(controller: coordinator)

        XCTAssertTrue(bridge.startDive())

        XCTAssertEqual(coordinator.actionButtonStartCallCount, 1)
    }

    func testBridgeReturnsRejectedStartWithoutMarkingRecordingActive() {
        let coordinator = FakeRealDiveActionController(acceptsStartRequest: false)
        let bridge = DiveActionButtonBridge(controller: coordinator)

        XCTAssertFalse(bridge.startDive())

        XCTAssertEqual(coordinator.actionButtonStartCallCount, 1)
        XCTAssertFalse(coordinator.isRecording)
    }

    func testBridgeForwardsAcceptedEndToCoordinatorOnce() {
        let coordinator = FakeRealDiveActionController(acceptsEndRequest: true)
        let bridge = DiveActionButtonBridge(controller: coordinator)

        XCTAssertTrue(bridge.requestEndDive())

        XCTAssertEqual(coordinator.actionButtonEndRequestCallCount, 1)
        XCTAssertFalse(coordinator.isRecording)
    }

    func testBridgeLeavesRecordingActiveWhenCoordinatorRejectsEnd() {
        let coordinator = FakeRealDiveActionController(acceptsEndRequest: false)
        let bridge = DiveActionButtonBridge(controller: coordinator)

        XCTAssertFalse(bridge.requestEndDive())

        XCTAssertEqual(coordinator.actionButtonEndRequestCallCount, 1)
        XCTAssertTrue(coordinator.isRecording)
    }

    func testBridgeRoutesEndToActiveOverrideBeforeRealCoordinator() {
        let coordinator = FakeRealDiveActionController(acceptsEndRequest: false)
        let bridge = DiveActionButtonBridge(controller: coordinator)
        var overrideCallCount = 0

        let token = bridge.installEndOverride {
            overrideCallCount += 1
            return true
        }

        XCTAssertTrue(bridge.requestEndDive())

        XCTAssertEqual(overrideCallCount, 1)
        XCTAssertEqual(coordinator.actionButtonEndRequestCallCount, 0)

        bridge.removeEndOverride(token)
        XCTAssertFalse(bridge.requestEndDive())
        XCTAssertEqual(coordinator.actionButtonEndRequestCallCount, 1)
    }

    func testStartIntentRoutesToActionButtonBridgeOnce() async throws {
        let coordinator = FakeRealDiveActionController()
        let intent = DivenaryStartDiveIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.actionButtonStartCallCount, 1)
    }

    func testEndIntentRoutesAcceptedEndRequestToBridgeOnce() async throws {
        let coordinator = FakeRealDiveActionController(acceptsEndRequest: true)
        let intent = DivenaryEndDiveIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.actionButtonEndRequestCallCount, 1)
        XCTAssertFalse(coordinator.isRecording)
    }

    func testEndIntentRoutesRejectedEndRequestToBridgeOnceAndKeepsRecording() async throws {
        let coordinator = FakeRealDiveActionController(acceptsEndRequest: false)
        let intent = DivenaryEndDiveIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.actionButtonEndRequestCallCount, 1)
        XCTAssertTrue(coordinator.isRecording)
    }

    func testDonorInvokesInjectedDonationOperationOnce() async {
        let invoked = expectation(description: "donation operation invoked")
        let recorder = DonationOperationRecorder()
        let donor = DiveActionButtonDonor {
            recorder.recordInvocation()
            invoked.fulfill()
        }

        donor.donateEndAction()

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

        donor.donateEndAction()

        await fulfillment(of: [invoked, failureObserved], timeout: 1)
        XCTAssertEqual(recorder.callCount, 1)
    }
}

@MainActor
private final class FakeRealDiveActionController: RealDiveActionControlling {
    private(set) var actionButtonStartCallCount = 0
    private(set) var actionButtonEndRequestCallCount = 0
    private(set) var isRecording = true

    private let acceptsEndRequest: Bool
    private let acceptsStartRequest: Bool

    init(acceptsEndRequest: Bool = true, acceptsStartRequest: Bool = true) {
        self.acceptsEndRequest = acceptsEndRequest
        self.acceptsStartRequest = acceptsStartRequest
    }

    func startFromActionButton() -> Bool {
        actionButtonStartCallCount += 1
        isRecording = acceptsStartRequest
        return acceptsStartRequest
    }

    func requestActionButtonEnd() -> Bool {
        actionButtonEndRequestCallCount += 1
        if acceptsEndRequest {
            isRecording = false
        }
        return acceptsEndRequest
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
