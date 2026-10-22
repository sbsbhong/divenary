import WatchKit
import XCTest
@testable import DivenaryWatchApp

@MainActor
final class RecordingPageModelTests: XCTestCase {
    func testActionButtonCyclesLiveAndDetailsUnderwaterWithAHapticPerChange() {
        let haptics = RecordedDiveHaptics()
        let model = makeRecordingModel(haptics: haptics, signals: underwater())

        XCTAssertEqual(model.pages, [.live, .details])
        XCTAssertEqual(model.nextActionButtonPage, .details)
        XCTAssertEqual(model.advanceFromActionButton(), .details)
        XCTAssertEqual(model.pageIndex, 1)
        XCTAssertEqual(model.nextActionButtonPage, .live)
        XCTAssertEqual(model.advanceFromActionButton(), .live)

        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .live, reason: .actionButton))
        XCTAssertTrue(model.lastChange?.userInitiated == true)
        XCTAssertEqual(haptics.events, [.pageChange, .pageChange])
        XCTAssertEqual(model.endAvailability, .notAtSurface)
    }

    func testSurfaceUnderTheMinimumCountsDownWithoutAnEndPage() {
        let model = makeRecordingModel(signals: atSurface(elapsed: 120.4))

        XCTAssertEqual(model.endAvailability, .availableIn(seconds: 60))
        XCTAssertEqual(model.pages, [.live, .details])

        model.receive(atSurface(elapsed: 179.2))
        XCTAssertEqual(model.endAvailability, .availableIn(seconds: 1))

        model.advanceFromActionButton()
        XCTAssertEqual(model.advanceFromActionButton(), .live)
    }

    func testEligibleSurfaceAddsTheEndPageAtTheEndOfTheActionButtonCycle() {
        let model = makeRecordingModel(signals: atSurface(elapsed: 180))

        XCTAssertEqual(model.endAvailability, .available)
        XCTAssertEqual(model.pages, [.live, .details, .end])
        XCTAssertEqual(model.advanceFromActionButton(), .details)
        XCTAssertEqual(model.nextActionButtonPage, .end)
        XCTAssertEqual(model.advanceFromActionButton(), .end)
        XCTAssertNil(model.nextActionButtonPage)
    }

    func testUnknownWaterStateNeverOffersTheEndPage() {
        var signals = atSurface(elapsed: 600)
        signals.waterState = .unknown
        let model = makeRecordingModel(signals: signals)

        XCTAssertEqual(model.endAvailability, .notAtSurface)
        XCTAssertEqual(model.pages, [.live, .details])
    }

    func testIdleTimeoutReturnsToLiveWithoutAHaptic() {
        let haptics = RecordedDiveHaptics()
        let scheduler = ManualPageReturnScheduler()
        let model = makeRecordingModel(haptics: haptics, scheduler: scheduler, signals: underwater())

        model.advanceFromActionButton()
        XCTAssertEqual(scheduler.scheduledDelay, RecordingPageModel.idleReturnSeconds)
        XCTAssertEqual(scheduler.scheduledDelay, 10)

        scheduler.fire()

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .live, reason: .idleTimeout))
        XCTAssertFalse(model.lastChange?.userInitiated ?? true)
        XCTAssertEqual(haptics.events, [.pageChange])
    }

    func testEachUserChangeRestartsTheIdleTimerAndLiveCancelsIt() {
        let scheduler = ManualPageReturnScheduler()
        let model = makeRecordingModel(scheduler: scheduler, signals: atSurface(elapsed: 200))

        model.advanceFromActionButton()
        model.advanceFromActionButton()
        XCTAssertEqual(scheduler.scheduleCount, 2)
        XCTAssertEqual(model.page, .end)

        model.advanceFromActionButton()

        XCTAssertEqual(model.page, .live)
        XCTAssertFalse(scheduler.hasPendingAction)
    }

    func testEndPageTimesOutBackToLive() {
        let scheduler = ManualPageReturnScheduler()
        let model = makeRecordingModel(scheduler: scheduler, signals: atSurface(elapsed: 200))
        model.advanceFromActionButton()
        model.advanceFromActionButton()

        scheduler.fire()

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange?.reason, .idleTimeout)
    }

    func testFreediveDescentAndSurfacingReturnToLiveWithoutAHaptic() {
        let haptics = RecordedDiveHaptics()
        var signals = atSurface(elapsed: 30)
        signals.freediveState = .surfaceReady
        let model = makeRecordingModel(haptics: haptics, signals: signals)

        model.advanceFromActionButton()
        signals.waterState = .submerged
        signals.freediveState = .diveActive
        model.receive(signals)

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .live, reason: .divePhase))

        model.advanceFromActionButton()
        signals.freediveState = .surfaceInterval
        model.receive(signals)

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange?.reason, .divePhase)
        XCTAssertEqual(haptics.events, [.pageChange, .pageChange])
    }

    func testRecommendedStopStartReturnsToLiveWithoutAHaptic() {
        let haptics = RecordedDiveHaptics()
        var signals = underwater()
        signals.safetyStopStatus = .armed
        let model = makeRecordingModel(haptics: haptics, signals: signals)
        model.advanceFromActionButton()

        signals.safetyStopStatus = .active
        model.receive(signals)

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .live, reason: .recommendedStop))
        XCTAssertFalse(model.lastChange?.userInitiated ?? true)
        XCTAssertEqual(haptics.events, [.pageChange])

        model.advanceFromActionButton()
        signals.safetyStopStatus = .pausedTooShallow
        model.receive(signals)
        signals.safetyStopStatus = .completed
        model.receive(signals)

        XCTAssertEqual(model.page, .details, "Only the stop becoming active moves the page")
        XCTAssertEqual(haptics.events, [.pageChange, .pageChange])
    }

    func testLiveDepthLeavingLiveReturnsToLiveWithoutAHaptic() {
        for lostSignal in [LiveDepthSignal.stale, .sensorError, .beyondSensorRange] {
            let haptics = RecordedDiveHaptics()
            var signals = underwater()
            let model = makeRecordingModel(haptics: haptics, signals: signals)
            model.advanceFromActionButton()

            signals.liveDepthSignal = lostSignal
            model.receive(signals)

            XCTAssertEqual(model.page, .live, "\(lostSignal)")
            XCTAssertEqual(model.lastChange?.reason, .depthSignal, "\(lostSignal)")
            XCTAssertEqual(haptics.events, [.pageChange], "\(lostSignal)")
        }
    }

    func testPagingIsAllowedAfterTheSignalIsAlreadyLost() {
        var signals = underwater()
        signals.liveDepthSignal = .stale
        let model = makeRecordingModel(signals: signals)

        model.advanceFromActionButton()
        signals.elapsedTime += 1
        model.receive(signals)

        XCTAssertEqual(model.page, .details)
    }

    func testAlwaysOnReturnsToLiveWithoutAHaptic() {
        let haptics = RecordedDiveHaptics()
        let model = makeRecordingModel(haptics: haptics, signals: underwater())
        model.advanceFromActionButton()

        model.setAlwaysOn(false)
        XCTAssertEqual(model.page, .details)
        model.setAlwaysOn(true)

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange?.reason, .alwaysOn)
        XCTAssertEqual(haptics.events, [.pageChange])
    }

    func testAlwaysOnIgnoresCrownAndActionPageAdvancesUntilDisplayWakes() {
        let haptics = RecordedDiveHaptics()
        let model = makeRecordingModel(haptics: haptics, signals: atSurface(elapsed: 300))
        model.advanceFromActionButton()
        model.advanceFromActionButton()
        model.setAlwaysOn(true)
        for _ in 0..<4 {
            model.stepFromCrown(by: 1)
            XCTAssertEqual(model.advanceFromActionButton(), .live)
        }
        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(haptics.events, [.pageChange, .pageChange])
        model.setAlwaysOn(false)
        XCTAssertEqual(model.advanceFromActionButton(), .details)
    }

    func testLosingEligibilityOnTheEndPageReturnsToLive() {
        let model = makeRecordingModel(signals: atSurface(elapsed: 200))
        model.advanceFromActionButton()
        model.advanceFromActionButton()

        var signals = atSurface(elapsed: 201)
        signals.waterState = .submerged
        model.receive(signals)

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange?.reason, .endUnavailable)
        XCTAssertEqual(model.pages, [.live, .details])
    }

    func testCrownMovesBetweenReadoutsButNeverSelectsTheEndPage() {
        let haptics = RecordedDiveHaptics()
        let model = makeRecordingModel(haptics: haptics, signals: atSurface(elapsed: 300))

        model.stepFromCrown(by: -1)
        XCTAssertEqual(model.page, .live)
        model.stepFromCrown(by: 1)
        XCTAssertEqual(model.page, .details)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .details, reason: .crown))
        model.stepFromCrown(by: 3)
        XCTAssertEqual(model.page, .details)

        model.advanceFromActionButton()
        XCTAssertEqual(model.page, .end)
        model.stepFromCrown(by: 1)
        XCTAssertEqual(model.page, .end)
        model.stepFromCrown(by: -1)
        XCTAssertEqual(model.page, .details)

        XCTAssertEqual(haptics.events, [.pageChange, .pageChange, .pageChange])
    }

    func testInputsAndSignalsAreIgnoredOutsideARecording() {
        let haptics = RecordedDiveHaptics()
        let model = RecordingPageModel(
            minimumEndElapsedSeconds: 180,
            haptics: haptics,
            returnScheduler: ManualPageReturnScheduler()
        )

        model.receive(atSurface(elapsed: 400))
        model.advanceFromActionButton()
        model.stepFromCrown(by: 1)

        XCTAssertEqual(model.page, .live)
        XCTAssertNil(model.lastChange)
        XCTAssertEqual(model.endAvailability, .notAtSurface)
        XCTAssertTrue(haptics.events.isEmpty)
    }

    func testEachRecordingStartsOnLiveAndStoppingClearsTheEndPage() {
        let scheduler = ManualPageReturnScheduler()
        let model = makeRecordingModel(scheduler: scheduler, signals: atSurface(elapsed: 300))
        model.advanceFromActionButton()
        model.advanceFromActionButton()

        model.setRecording(false)

        XCTAssertEqual(model.page, .live)
        XCTAssertNil(model.lastChange)
        XCTAssertEqual(model.endAvailability, .notAtSurface)
        XCTAssertFalse(scheduler.hasPendingAction)

        model.setRecording(true)
        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.endAvailability, .available)
    }

    func testActionFeedbackCountsEveryPress() {
        let model = makeRecordingModel(signals: underwater())

        model.recordActionFeedback(.rejected(.busy))
        model.recordActionFeedback(.rejected(.busy))

        XCTAssertEqual(model.lastActionFeedback, DiveActionFeedback(id: 2, outcome: .rejected(.busy)))
    }

    func testSwitchPageFollowsDetailsUntilTheFirstDescent() {
        let model = makeRecordingModel(signals: underwater(maxDepth: 0.4))

        XCTAssertTrue(model.modeSwitchAvailable)
        XCTAssertEqual(model.pages, [.live, .details, .switchMode])
        XCTAssertEqual(model.advanceFromActionButton(), .details)
        XCTAssertEqual(model.nextActionButtonPage, .switchMode)

        model.receive(underwater(maxDepth: 1))

        XCTAssertFalse(model.modeSwitchAvailable)
        XCTAssertEqual(model.pages, [.live, .details])
        XCTAssertEqual(model.page, .details)
    }

    func testDescendingOnTheSwitchPageReturnsToLiveWithoutAHaptic() {
        let haptics = RecordedDiveHaptics()
        let scheduler = ManualPageReturnScheduler()
        let model = makeRecordingModel(haptics: haptics, scheduler: scheduler, signals: underwater(maxDepth: 0))
        model.stepFromCrown(by: 2)
        XCTAssertEqual(model.page, .switchMode)

        model.receive(underwater(maxDepth: 1.2))

        XCTAssertEqual(model.page, .live)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .live, reason: .modeSwitchClosed))
        XCTAssertFalse(model.lastChange?.userInitiated ?? true)
        XCTAssertFalse(scheduler.hasPendingAction)
        XCTAssertEqual(haptics.events, [.pageChange])
    }

    func testCrownReachesTheSwitchPageAndTurnsBackFromIt() {
        let model = makeRecordingModel(signals: underwater(maxDepth: 0))

        model.stepFromCrown(by: 5)
        XCTAssertEqual(model.page, .switchMode)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .switchMode, reason: .crown))
        model.stepFromCrown(by: -1)
        XCTAssertEqual(model.page, .details)
    }

    func testEligibleSurfaceOffersTheEndPageInsteadOfTheSwitchPage() {
        let model = makeRecordingModel(signals: atSurface(elapsed: 120, maxDepth: 0))
        XCTAssertEqual(model.pages, [.live, .details, .switchMode])
        model.stepFromCrown(by: 2)

        model.receive(atSurface(elapsed: 180, maxDepth: 0))

        XCTAssertEqual(model.pages, [.live, .details, .end])
        XCTAssertFalse(model.modeSwitchAvailable)
        XCTAssertEqual(model.lastChange, RecordingPageChange(page: .live, reason: .modeSwitchClosed))

        model.receive(underwater(maxDepth: 0))

        XCTAssertEqual(model.pages, [.live, .details, .switchMode])
    }

    func testRestartedRecordingStartsOnLiveWithTheSwitchOpen() {
        let scheduler = ManualPageReturnScheduler()
        let model = makeRecordingModel(scheduler: scheduler, signals: underwater(maxDepth: 0.5))
        model.stepFromCrown(by: 2)

        model.restartRecording()

        XCTAssertEqual(model.page, .live)
        XCTAssertNil(model.lastChange)
        XCTAssertTrue(model.modeSwitchAvailable)
        XCTAssertFalse(scheduler.hasPendingAction)
    }

    private func makeRecordingModel(
        haptics: RecordedDiveHaptics? = nil,
        scheduler: ManualPageReturnScheduler? = nil,
        signals: RecordingPageSignals
    ) -> RecordingPageModel {
        let model = RecordingPageModel(
            minimumEndElapsedSeconds: 180,
            haptics: haptics ?? RecordedDiveHaptics(),
            returnScheduler: scheduler ?? ManualPageReturnScheduler()
        )
        model.receive(signals)
        model.setRecording(true)
        return model
    }

    /// By default the diver has already been below the switch limit, so the switch page is closed.
    private func underwater(maxDepth: Double = 5) -> RecordingPageSignals {
        RecordingPageSignals(
            waterState: .submerged,
            elapsedTime: 240,
            liveDepthSignal: .live,
            freediveState: nil,
            safetyStopStatus: .notRequired,
            maxDepthMeters: maxDepth
        )
    }

    private func atSurface(elapsed: TimeInterval, maxDepth: Double = 5) -> RecordingPageSignals {
        RecordingPageSignals(
            waterState: .notSubmerged,
            elapsedTime: elapsed,
            liveDepthSignal: .stale,
            freediveState: nil,
            safetyStopStatus: .notRequired,
            maxDepthMeters: maxDepth
        )
    }
}

final class ActionButtonHintTests: XCTestCase {
    func testOnlyUltraModelIdentifiersReadAsLikelyActionButton() {
        XCTAssertTrue(ActionButtonHint(modelIdentifier: "Watch6,18").isLikelyUltra)
        XCTAssertTrue(ActionButtonHint(modelIdentifier: "Watch7,5").isLikelyUltra)
        XCTAssertTrue(ActionButtonHint(modelIdentifier: "Watch7,12").isLikelyUltra)

        XCTAssertFalse(ActionButtonHint(modelIdentifier: "Watch7,1").isLikelyUltra)
        XCTAssertFalse(ActionButtonHint(modelIdentifier: "arm64").isLikelyUltra)
        XCTAssertFalse(ActionButtonHint(modelIdentifier: "").isLikelyUltra)
        XCTAssertFalse(ActionButtonHint(modelIdentifier: nil).isLikelyUltra)
    }
}

final class DepthAutoLaunchStatusTests: XCTestCase {
    func testMapsEveryWatchOSAuthorizationStatus() {
        XCTAssertEqual(DepthAutoLaunchStatus(.active), .active)
        XCTAssertEqual(DepthAutoLaunchStatus(.inactive), .inactive)
        XCTAssertEqual(DepthAutoLaunchStatus(.unknown), .unknown)
    }
}

/// Records haptic events instead of playing them. Shared with `RealDiveSessionCoordinatorTests`.
@MainActor
final class RecordedDiveHaptics: DiveHapticPlaying {
    private(set) var events: [DiveHapticEvent] = []

    func play(_ event: DiveHapticEvent) {
        events.append(event)
    }
}

/// Holds the idle-return action until a test fires it. Shared with `RealDiveSessionCoordinatorTests`.
@MainActor
final class ManualPageReturnScheduler: RecordingPageReturnScheduling {
    private var action: (@MainActor () -> Void)?
    private(set) var scheduledDelay: TimeInterval?
    private(set) var scheduleCount = 0

    var hasPendingAction: Bool {
        action != nil
    }

    func schedule(after delay: TimeInterval, _ action: @escaping @MainActor () -> Void) {
        scheduleCount += 1
        scheduledDelay = delay
        self.action = action
    }

    func cancel() {
        action = nil
    }

    func fire() {
        let pendingAction = action
        action = nil
        pendingAction?()
    }
}
