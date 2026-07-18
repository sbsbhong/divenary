import XCTest
@testable import DivenaryWatchApp

@MainActor
final class DiveActionButtonIntentTests: XCTestCase {
    func testBridgeStartsFromActionButtonOnce() {
        let coordinator = FakeRealDiveActionController()
        let bridge = DiveActionButtonBridge(controller: coordinator)

        bridge.startDive()

        XCTAssertEqual(coordinator.actionButtonStartCallCount, 1)
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

    func testStartIntentInvokesActionButtonSourceOnceAndReturnsEndAction() async throws {
        let coordinator = FakeRealDiveActionController()
        let intent = DivenaryStartDiveIntent(
            bridge: DiveActionButtonBridge(controller: coordinator)
        )

        _ = try await intent.perform()

        XCTAssertEqual(coordinator.actionButtonStartCallCount, 1)
    }
}

@MainActor
private final class FakeRealDiveActionController: RealDiveActionControlling {
    private(set) var actionButtonStartCallCount = 0
    private(set) var actionButtonEndRequestCallCount = 0
    private(set) var isRecording = true

    private let acceptsEndRequest: Bool

    init(acceptsEndRequest: Bool = true) {
        self.acceptsEndRequest = acceptsEndRequest
    }

    func startFromActionButton() {
        actionButtonStartCallCount += 1
        isRecording = true
    }

    func requestActionButtonEnd() -> Bool {
        actionButtonEndRequestCallCount += 1
        if acceptsEndRequest {
            isRecording = false
        }
        return acceptsEndRequest
    }
}
