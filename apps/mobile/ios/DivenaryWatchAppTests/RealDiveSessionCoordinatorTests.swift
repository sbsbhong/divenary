import Combine
import WatchKit
import XCTest
@testable import DivenaryWatchApp

@MainActor
final class RealDiveSessionCoordinatorTests: XCTestCase {
    func testManualRecorderStartFailureDoesNotStartRuntimeOrDonateDiveAction() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, startResults: [false])
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        XCTAssertFalse(coordinator.startManual(plan: PreDivePlan(diveMode: .scuba)))

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .scuba)])
        XCTAssertEqual(runtime.startManualCallCount, 0)
        XCTAssertEqual(runtime.invalidateCallCount, 0)
        XCTAssertEqual(donor.callCount, 0)
        assertStartPersistenceError(coordinator, source: .manual)
        coordinator.dismissStartPersistenceError()
        assertIdle(coordinator)
    }

    func testActionButtonRecorderStartFailureDoesNotStartRuntime() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, startResults: [false])
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)

        XCTAssertFalse(coordinator.startFromActionButton())

        XCTAssertEqual(runtime.startManualCallCount, 0)
        XCTAssertEqual(runtime.invalidateCallCount, 0)
        assertStartPersistenceError(coordinator, source: .actionButton)
    }

    func testAdoptedRecorderStartFailureInvalidatesRuntimeExactlyOnceWithoutDonation() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, startResults: [false])
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        runtime.emit(.adoptedSystemSession)
        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(runtime.startManualCallCount, 0)
        XCTAssertEqual(runtime.invalidateCallCount, 1)
        XCTAssertEqual(donor.callCount, 0)
        assertAwaitingRuntimeInvalidation(coordinator, source: .systemAutoLaunch)
        coordinator.dismissStartPersistenceError()
        assertAwaitingRuntimeInvalidation(coordinator, source: .systemAutoLaunch)
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertStartPersistenceError(coordinator, source: .systemAutoLaunch)
    }

    func testAdoptedSetupFailureBlocksReentryUntilMatchingInvalidationAndIgnoresStaleCallback() {
        let adoptedAdapter = CoordinatorRuntimeAdapter()
        let manualAdapter = CoordinatorRuntimeAdapter()
        let runtime = DiveRuntimeSessionController(
            factory: CoordinatorRuntimeAdapterFactory(
                manualAdapters: [manualAdapter],
                adoptedAdapters: [adoptedAdapter]
            )
        )
        let calls = LifecycleCallLog()
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            startResults: [false, true]
        )
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: donor,
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: FakeDiveSessionStore(),
            schedulePersistence: { $0() }
        )

        runtime.adoptSystemSession(WKExtendedRuntimeSession())

        assertAwaitingRuntimeInvalidation(coordinator, source: .systemAutoLaunch)
        coordinator.dismissStartPersistenceError()
        XCTAssertFalse(coordinator.startManual(plan: PreDivePlan(diveMode: .scuba)))
        XCTAssertFalse(coordinator.startFromActionButton())
        assertAwaitingRuntimeInvalidation(coordinator, source: .systemAutoLaunch)
        XCTAssertEqual(recorder.startedPlans.count, 1)
        XCTAssertEqual(adoptedAdapter.calls, [.setDelegate, .invalidate])
        XCTAssertEqual(donor.callCount, 0)

        adoptedAdapter.emitInvalidation(reason: .none, error: nil)

        assertStartPersistenceError(coordinator, source: .systemAutoLaunch)
        coordinator.dismissStartPersistenceError()
        assertIdle(coordinator)
        XCTAssertEqual(recorder.cancelCallCount, 1)

        XCTAssertTrue(coordinator.startManual(plan: PreDivePlan(diveMode: .scuba)))
        assertRecording(coordinator, source: .manual)
        XCTAssertEqual(manualAdapter.calls, [.setDelegate, .start])
        XCTAssertEqual(donor.callCount, 1)

        adoptedAdapter.emitInvalidation(reason: .expired, error: nil)

        assertRecording(coordinator, source: .manual)
        XCTAssertEqual(recorder.stopCallCount, 0)
    }

    func testManualRuntimeAcquisitionFailureCleansRecorderWithoutRecordingOrDonation() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls, startResults: [false])
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        XCTAssertFalse(coordinator.startManual(plan: PreDivePlan(diveMode: .scuba)))

        XCTAssertEqual(
            calls.values,
            ["recorder.start", "runtime.startManual", "recorder.cancel", "runtime.invalidate"]
        )
        XCTAssertEqual(recorder.cancelCallCount, 1)
        XCTAssertEqual(donor.callCount, 0)
        assertAwaitingRuntimeInvalidation(coordinator, source: .manual)
        coordinator.dismissStartPersistenceError()
        assertAwaitingRuntimeInvalidation(coordinator, source: .manual)
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertStartPersistenceError(coordinator, source: .manual)
    }

    func testActionRuntimeAcquisitionFailureCleansRecorderWithoutExposingRecording() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls, startResults: [false])
        let recorder = FakeDiveRecorder(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)

        XCTAssertFalse(coordinator.startFromActionButton())

        XCTAssertEqual(
            calls.values,
            ["recorder.start", "runtime.startManual", "recorder.cancel", "runtime.invalidate"]
        )
        XCTAssertEqual(recorder.cancelCallCount, 1)
        assertAwaitingRuntimeInvalidation(coordinator, source: .actionButton)
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertStartPersistenceError(coordinator, source: .actionButton)
    }

    func testManualRuntimeCollisionWaitsForMatchingInvalidationBeforeRetryingFreshAdapter() {
        let staleAdapter = CoordinatorRuntimeAdapter()
        let freshAdapter = CoordinatorRuntimeAdapter()
        let runtime = DiveRuntimeSessionController(
            factory: CoordinatorRuntimeAdapterFactory(
                manualAdapters: [staleAdapter, freshAdapter],
                adoptedAdapters: []
            )
        )
        XCTAssertTrue(runtime.startManualSession())
        let calls = LifecycleCallLog()
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            startResults: [true, true]
        )
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: donor,
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: FakeDiveSessionStore(),
            schedulePersistence: { $0() }
        )

        XCTAssertFalse(coordinator.startManual(plan: PreDivePlan(diveMode: .scuba)))

        assertAwaitingRuntimeInvalidation(coordinator, source: .manual)
        XCTAssertEqual(staleAdapter.calls, [.setDelegate, .start, .invalidate])
        XCTAssertEqual(recorder.cancelCallCount, 1)
        XCTAssertEqual(donor.callCount, 0)
        coordinator.dismissStartPersistenceError()
        XCTAssertFalse(coordinator.startManual(plan: PreDivePlan(diveMode: .freedive)))
        XCTAssertFalse(coordinator.startFromActionButton())
        assertAwaitingRuntimeInvalidation(coordinator, source: .manual)
        XCTAssertEqual(recorder.startedPlans.count, 1)

        staleAdapter.emitInvalidation(reason: .none, error: nil)

        assertStartPersistenceError(coordinator, source: .manual)
        coordinator.dismissStartPersistenceError()
        assertIdle(coordinator)

        XCTAssertTrue(coordinator.startManual(plan: PreDivePlan(diveMode: .freedive)))
        assertRecording(coordinator, source: .manual)
        XCTAssertEqual(freshAdapter.calls, [.setDelegate, .start])
        XCTAssertEqual(donor.callCount, 1)

        staleAdapter.emitInvalidation(reason: .expired, error: nil)

        assertRecording(coordinator, source: .manual)
        XCTAssertEqual(recorder.stopCallCount, 0)
    }

    func testRuntimeAcquisitionCleanupFailureRemainsDismissibleOnlyAfterCleanupRetrySucceeds() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls, startResults: [false])
        let recorder = FakeDiveRecorder(calls: calls, cancelResults: [false, false, true])
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)

        XCTAssertFalse(coordinator.startManual(plan: PreDivePlan()))
        assertAwaitingRuntimeInvalidation(coordinator, source: .manual)
        coordinator.dismissStartPersistenceError()
        assertAwaitingRuntimeInvalidation(coordinator, source: .manual)
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertStartPersistenceError(coordinator, source: .manual)

        coordinator.dismissStartPersistenceError()
        assertStartPersistenceError(coordinator, source: .manual)

        coordinator.dismissStartPersistenceError()
        assertIdle(coordinator)
        XCTAssertEqual(recorder.cancelCallCount, 3)
    }

    func testManualStartPreservesPlanStartsRecorderBeforeRuntimeAndDonatesDiveAction() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)
        let plan = PreDivePlan(
            sourcePlanLocalId: "plan-7",
            title: "Morning reef",
            diveMode: .freedive,
            gasLabel: "Air",
            siteName: "East reef",
            buddyName: "Taylor",
            gearIds: ["mask"],
            userTags: ["calm"],
            quickNote: "Check buoyancy",
            plannedMaxDepthMeters: 14,
            plannedDurationMinutes: 40
        )

        coordinator.startManual(plan: plan)

        XCTAssertEqual(recorder.startedPlans, [plan])
        XCTAssertEqual(calls.values.prefix(2), ["recorder.start", "runtime.startManual"])
        XCTAssertEqual(donor.callCount, 1)
        assertRecording(coordinator, source: .manual)
    }

    func testActionButtonStartUsesPreferredModeAndStartsManualRuntimeWithoutDonation() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(
            preferredMode: .freedive,
            runtime: runtime,
            recorder: recorder,
            donor: donor
        )

        coordinator.startFromActionButton()

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
        XCTAssertEqual(runtime.startManualCallCount, 1)
        XCTAssertEqual(donor.callCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testAdoptedSystemSessionUsesPreferredModeImmediatelyWithoutStartingRuntimeAndDonatesDiveAction() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(
            preferredMode: .freedive,
            runtime: runtime,
            recorder: recorder,
            donor: donor
        )

        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
        XCTAssertEqual(runtime.startManualCallCount, 0)
        XCTAssertEqual(donor.callCount, 1)
        assertRecording(coordinator, source: .systemAutoLaunch)
    }

    func testSubmersionEntersWetReadyWithoutStartingRecorder() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader(latestState: .submerged)
        let preference = FakeDiveModePreference(mode: .freedive)
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            water: water,
            preference: preference
        )

        coordinator.receiveWaterState(.submerged)

        assertWetReady(coordinator, mode: .freedive)
        XCTAssertTrue(recorder.startedPlans.isEmpty)
        XCTAssertEqual(runtime.startManualCallCount, 0)
    }

    func testWetReadySelectionPersistsAndAdoptedRuntimeLocksSelectedPlan() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader(latestState: .submerged)
        let preference = FakeDiveModePreference(mode: .scuba)
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            water: water,
            preference: preference
        )
        coordinator.receiveWaterState(.submerged)

        coordinator.selectWetReadyMode(.freedive)
        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(preference.mode, .freedive)
        XCTAssertEqual(preference.updates, [.freedive])
        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
        assertRecording(
            coordinator,
            source: .systemAutoLaunch,
            plan: PreDivePlan(diveMode: .freedive)
        )
    }

    func testRuntimeBeforeWaterEventUsesPreferredModeFallback() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let preference = FakeDiveModePreference(mode: .scuba)
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            preference: preference
        )

        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .scuba)])
        assertRecording(
            coordinator,
            source: .systemAutoLaunch,
            plan: PreDivePlan(diveMode: .scuba)
        )
    }

    func testStableDryExitDismissesWetReadyWithoutCreatingSession() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader(latestState: .submerged)
        let scheduler = FakeWetReadyExitScheduler()
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            water: water,
            scheduler: scheduler
        )
        coordinator.receiveWaterState(.submerged)

        water.latestState = .notSubmerged
        coordinator.receiveWaterState(.notSubmerged)
        assertWetReady(coordinator, mode: .scuba)
        scheduler.fire()

        assertIdle(coordinator)
        XCTAssertTrue(recorder.startedPlans.isEmpty)
        XCTAssertEqual(recorder.cancelCallCount, 0)
    }

    func testResubmersionCancelsPendingWetReadyExit() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader(latestState: .submerged)
        let scheduler = FakeWetReadyExitScheduler()
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            water: water,
            scheduler: scheduler
        )
        coordinator.receiveWaterState(.submerged)
        water.latestState = .notSubmerged
        coordinator.receiveWaterState(.notSubmerged)

        water.latestState = .submerged
        coordinator.receiveWaterState(.submerged)
        scheduler.fire()

        assertWetReady(coordinator, mode: .scuba)
        XCTAssertEqual(scheduler.cancelCallCount, 1)
    }

    func testActionButtonFromWetReadyUsesArmedMode() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader(latestState: .submerged)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.receiveWaterState(.submerged)
        coordinator.selectWetReadyMode(.freedive)

        XCTAssertTrue(coordinator.startFromActionButton())

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .freedive)])
        assertRecording(
            coordinator,
            source: .actionButton,
            plan: PreDivePlan(diveMode: .freedive)
        )
    }

    func testRecordingRejectsWetReadyModeChanges() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let preference = FakeDiveModePreference(mode: .scuba)
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            preference: preference
        )
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))

        coordinator.selectWetReadyMode(.freedive)

        XCTAssertTrue(preference.updates.isEmpty)
        assertRecording(
            coordinator,
            source: .manual,
            plan: PreDivePlan(diveMode: .scuba)
        )
    }

    func testDonationFailureDoesNotCancelRecording() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls, shouldFail: true)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        coordinator.startManual(plan: PreDivePlan())

        XCTAssertEqual(donor.callCount, 1)
        XCTAssertEqual(recorder.cancelCallCount, 0)
        assertRecording(coordinator, source: .manual)
    }

    func testDuplicateStartsWhileRecordingDoNothing() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)

        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        coordinator.startManual(plan: PreDivePlan(diveMode: .freedive))
        coordinator.startFromActionButton()
        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(recorder.startedPlans, [PreDivePlan(diveMode: .scuba)])
        XCTAssertEqual(runtime.startManualCallCount, 1)
        XCTAssertEqual(donor.callCount, 1)
        assertRecording(coordinator, source: .manual)
    }

    func testWaterStateChangesDoNotStopOrReplaceRecording() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)

        coordinator.startManual(plan: PreDivePlan())
        water.latestState = .notSubmerged
        water.latestState = .submerged
        runtime.emit(.didStart)

        XCTAssertEqual(recorder.stopCallCount, 0)
        XCTAssertEqual(recorder.cancelCallCount, 0)
        assertRecording(coordinator, source: .manual)
    }

    func testActionButtonEndRejectsSubmergedUnknownAndTooShortRecordings() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let water = FakeWaterStateReader()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startFromActionButton()

        water.latestState = .submerged
        recorder.elapsedTime = 180
        XCTAssertFalse(coordinator.requestActionButtonEnd())

        water.latestState = .unknown
        recorder.currentDepth = 4
        XCTAssertFalse(coordinator.requestActionButtonEnd())

        water.latestState = .notSubmerged
        recorder.elapsedTime = 179
        XCTAssertFalse(coordinator.requestActionButtonEnd())

        XCTAssertEqual(runtime.invalidateCallCount, 0)
        XCTAssertEqual(recorder.stopCallCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testActionButtonEndRejectsUnknownWaterStateEvenNearTheSurface() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 600, currentDepth: 0.3)
        let water = FakeWaterStateReader(latestState: .unknown)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startFromActionButton()

        XCTAssertFalse(coordinator.requestActionButtonEnd())

        XCTAssertEqual(runtime.invalidateCallCount, 0)
        XCTAssertEqual(recorder.stopCallCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testActionButtonEndInvalidatesSurfacedRecordingWithoutStoppingRecorderDirectly() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 180)
        let water = FakeWaterStateReader(latestState: .notSubmerged)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startFromActionButton()

        XCTAssertTrue(coordinator.requestActionButtonEnd())

        XCTAssertEqual(runtime.invalidateCallCount, 1)
        XCTAssertEqual(recorder.stopCallCount, 0)
        assertRecording(coordinator, source: .actionButton)
    }

    func testActionButtonPressFromIdleStartsWithAStartHaptic() {
        let calls = LifecycleCallLog()
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(
            preferredMode: .freedive,
            runtime: FakeDiveRuntime(calls: calls),
            recorder: FakeDiveRecorder(calls: calls),
            haptics: haptics
        )

        XCTAssertEqual(coordinator.handleActionButtonPress(), .started)

        assertRecording(coordinator, source: .actionButton, plan: PreDivePlan(diveMode: .freedive))
        XCTAssertEqual(haptics.events, [.start])
        XCTAssertEqual(coordinator.recordingPages.page, .live)
        XCTAssertEqual(coordinator.recordingPages.lastActionFeedback?.outcome, .started)
    }

    func testActionButtonPressFromWetReadyStartsTheArmedMode() {
        let calls = LifecycleCallLog()
        let coordinator = makeCoordinator(
            runtime: FakeDiveRuntime(calls: calls),
            recorder: FakeDiveRecorder(calls: calls)
        )
        coordinator.receiveWaterState(.submerged)
        coordinator.selectWetReadyMode(.freedive)

        XCTAssertEqual(coordinator.handleActionButtonPress(), .started)

        assertRecording(coordinator, source: .actionButton, plan: PreDivePlan(diveMode: .freedive))
    }

    func testActionButtonPressFromSavedSummaryStartsTheNextDive() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, haptics: haptics)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertSavedSummary(coordinator)

        XCTAssertEqual(coordinator.handleActionButtonPress(), .started)

        assertRecording(coordinator, source: .actionButton)
        XCTAssertEqual(recorder.startedPlans.count, 2)
        XCTAssertEqual(haptics.events, [.start, .saved, .start])
    }

    func testRejectedActionButtonStartPlaysARejectionHaptic() {
        let calls = LifecycleCallLog()
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(
            runtime: FakeDiveRuntime(calls: calls),
            recorder: FakeDiveRecorder(calls: calls, startResults: [false]),
            haptics: haptics
        )

        XCTAssertEqual(coordinator.handleActionButtonPress(), .rejected(.startFailed))

        assertStartPersistenceError(coordinator, source: .actionButton)
        XCTAssertEqual(haptics.events, [.rejected])
        XCTAssertEqual(coordinator.recordingPages.lastActionFeedback?.outcome, .rejected(.startFailed))
    }

    func testActionButtonPagesUnderwaterAndNeverEnds() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 900)
        let water = FakeWaterStateReader(latestState: .submerged)
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water, haptics: haptics)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        coordinator.recordingPages.receive(signals(water: .submerged, elapsed: 900))

        let outcomes = (0..<4).map { _ in coordinator.handleActionButtonPress() }

        XCTAssertEqual(outcomes, [
            .pageChanged(.details),
            .pageChanged(.live),
            .pageChanged(.details),
            .pageChanged(.live),
        ])
        XCTAssertEqual(runtime.invalidateCallCount, 0)
        XCTAssertEqual(recorder.stopCallCount, 0)
        XCTAssertEqual(haptics.events, [.start, .pageChange, .pageChange, .pageChange, .pageChange])
        assertRecording(coordinator, source: .manual)
    }

    func testActionButtonAtTheSurfaceUnderTheMinimumPagesAndShowsTheRemainingTime() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 150)
        let water = FakeWaterStateReader(latestState: .notSubmerged)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startFromActionButton()
        coordinator.recordingPages.receive(signals(water: .notSubmerged, elapsed: 150))

        XCTAssertEqual(coordinator.recordingPages.endAvailability, .availableIn(seconds: 30))
        XCTAssertEqual(coordinator.handleActionButtonPress(), .pageChanged(.details))
        XCTAssertEqual(coordinator.handleActionButtonPress(), .pageChanged(.live))
        XCTAssertEqual(runtime.invalidateCallCount, 0)
    }

    func testActionButtonEndsOnlyFromTheEndPageThroughTheGuardedPath() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 180)
        let water = FakeWaterStateReader(latestState: .notSubmerged)
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water, haptics: haptics)
        coordinator.startFromActionButton()
        coordinator.recordingPages.receive(signals(water: .notSubmerged, elapsed: 180))

        XCTAssertEqual(coordinator.handleActionButtonPress(), .pageChanged(.details))
        XCTAssertEqual(coordinator.handleActionButtonPress(), .pageChanged(.end))
        XCTAssertEqual(runtime.invalidateCallCount, 0)

        XCTAssertEqual(coordinator.handleActionButtonPress(), .endRequested)

        XCTAssertEqual(runtime.invalidateCallCount, 1)
        XCTAssertEqual(recorder.stopCallCount, 0)
        XCTAssertEqual(haptics.events, [.pageChange, .pageChange, .endRequested])
        assertRecording(coordinator, source: .actionButton)
    }

    func testEndPagePressIsRejectedWhenTheGuardNoLongerPasses() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, elapsedTime: 240)
        let water = FakeWaterStateReader(latestState: .notSubmerged)
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water, haptics: haptics)
        coordinator.startFromActionButton()
        coordinator.recordingPages.receive(signals(water: .notSubmerged, elapsed: 240))
        _ = coordinator.handleActionButtonPress()
        _ = coordinator.handleActionButtonPress()
        XCTAssertEqual(coordinator.recordingPages.page, .end)

        water.latestState = .submerged
        XCTAssertEqual(coordinator.handleActionButtonPress(), .rejected(.endUnavailable))

        XCTAssertEqual(runtime.invalidateCallCount, 0)
        XCTAssertEqual(coordinator.recordingPages.page, .live)
        XCTAssertEqual(coordinator.recordingPages.lastChange?.reason, .endUnavailable)
        XCTAssertEqual(haptics.events, [.pageChange, .pageChange, .rejected])
        XCTAssertEqual(
            coordinator.recordingPages.lastActionFeedback,
            DiveActionFeedback(id: 3, outcome: .rejected(.endUnavailable))
        )
        assertRecording(coordinator, source: .actionButton)
    }

    func testActionButtonPressWhileSavingIsRejected() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let haptics = RecordedDiveHaptics()
        var scheduledSave: (@MainActor () -> Void)?
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: FakeActionButtonDonor(calls: calls),
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: FakeDiveSessionStore(),
            schedulePersistence: { scheduledSave = $0 },
            haptics: haptics,
            pageReturnScheduler: ManualPageReturnScheduler()
        )
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(coordinator.handleActionButtonPress(), .rejected(.busy))
        XCTAssertEqual(recorder.startedPlans.count, 1)

        scheduledSave?()

        assertSavedSummary(coordinator)
        XCTAssertEqual(haptics.events, [.start, .rejected, .saved])
    }

    func testOnlyUserCausedStartsPlayAStartHaptic() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let haptics = RecordedDiveHaptics()
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: FakeDiveRecorder(calls: calls),
            haptics: haptics
        )

        runtime.emit(.adoptedSystemSession)

        assertRecording(coordinator, source: .systemAutoLaunch)
        XCTAssertTrue(haptics.events.isEmpty)
    }

    func testRecordingPagesFollowTheRecordingPhase() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        XCTAssertFalse(coordinator.recordingPages.isRecording)

        coordinator.startManual(plan: PreDivePlan())
        XCTAssertTrue(coordinator.recordingPages.isRecording)
        _ = coordinator.handleActionButtonPress()
        XCTAssertEqual(coordinator.recordingPages.page, .details)

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertSavedSummary(coordinator)
        XCTAssertFalse(coordinator.recordingPages.isRecording)
        XCTAssertEqual(coordinator.recordingPages.page, .live)
    }

    func testRecommendedStopBecomingActiveReturnsToLiveWithoutAHaptic() {
        let calls = LifecycleCallLog()
        let sensorProvider = RetainingManualDepthSensorProvider()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            profileStore: CountingProfileRecordingStore(),
            now: { EngineTestFixtures.date(2) }
        )
        let water = CurrentValueSubject<WaterSubmersionState, Never>(.submerged)
        let haptics = RecordedDiveHaptics()
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: FakeDiveRuntime(calls: calls),
            recorder: recorder,
            water: FakeWaterStateReader(latestState: .submerged),
            actionButtonDonor: FakeActionButtonDonor(calls: calls),
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: FakeDiveSessionStore(),
            schedulePersistence: { $0() },
            haptics: haptics,
            pageReturnScheduler: ManualPageReturnScheduler()
        )
        coordinator.recordingPages.observe(recorder: recorder, waterState: water.eraseToAnyPublisher())
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        sensorProvider.emit(EngineTestFixtures.sample(0, depth: 12))
        XCTAssertEqual(recorder.scubaSafetyStop.status, .armed)
        XCTAssertEqual(coordinator.handleActionButtonPress(), .pageChanged(.details))
        let eventsBeforeStop = haptics.events

        sensorProvider.emit(EngineTestFixtures.sample(2, depth: 5))

        XCTAssertEqual(recorder.scubaSafetyStop.status, .active)
        XCTAssertEqual(coordinator.recordingPages.page, .live)
        XCTAssertEqual(coordinator.recordingPages.lastChange?.reason, .recommendedStop)
        XCTAssertFalse(coordinator.recordingPages.lastChange?.userInitiated ?? true)
        XCTAssertEqual(haptics.events, eventsBeforeStop)
        XCTAssertEqual(eventsBeforeStop, [.start, .pageChange])
    }

    func testRuntimeInvalidationWithSamplesAutomaticallySavesExactlyOnce() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1).applyingPostDive(
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            notes: nil
        )
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            stopResult: record
        )
        let sessionStore = FakeDiveSessionStore(saveResults: [true])
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            sessionStore: sessionStore
        )
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id])
        XCTAssertEqual(recorder.stopCallCount, 1)
        XCTAssertEqual(recorder.resetCompletedSessionCallCount, 1)
        let saved = assertSavedSummary(coordinator)
        XCTAssertNil(saved.rating)
        XCTAssertNil(saved.perceivedExertion)
        XCTAssertNil(saved.visibilityRating)
        XCTAssertNil(saved.notes)
        XCTAssertEqual(saved.waterCondition, .unknown)
    }

    func testSaveFailureRetainsRecordAndRetriesSameSessionID() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            stopResult: record
        )
        let sessionStore = FakeDiveSessionStore(saveResults: [false, true])
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            sessionStore: sessionStore
        )
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertSavePersistenceError(coordinator, recordID: record.id)
        XCTAssertEqual(recorder.resetCompletedSessionCallCount, 0)

        coordinator.retryCompletedSessionSave()
        coordinator.retryCompletedSessionSave()

        XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id, record.id])
        XCTAssertEqual(recorder.resetCompletedSessionCallCount, 1)
        XCTAssertEqual(assertSavedSummary(coordinator).id, record.id)
    }

    func testShowsSavingBeforeTheSaveRuns() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            stopResult: record
        )
        let sessionStore = FakeDiveSessionStore(saveResults: [true])
        var scheduledSave: (@MainActor () -> Void)?
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: FakeActionButtonDonor(calls: calls),
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: sessionStore,
            schedulePersistence: { scheduledSave = $0 }
        )
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        guard case .completing = coordinator.phase else {
            return XCTFail("Expected completing phase, received \(coordinator.phase)")
        }
        XCTAssertTrue(sessionStore.saveAttempts.isEmpty)

        scheduledSave?()

        XCTAssertEqual(assertSavedSummary(coordinator).id, record.id)
        XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id])
    }

    func testDismissSavedSummaryOnlyChangesUIState() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let recorder = FakeDiveRecorder(
            calls: calls,
            hasCapturedDepthSample: true,
            stopResult: record
        )
        let sessionStore = FakeDiveSessionStore(saveResults: [true])
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            sessionStore: sessionStore
        )
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        coordinator.dismissSavedSummary()
        coordinator.dismissSavedSummary()

        assertIdle(coordinator)
        XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id])
        XCTAssertEqual(recorder.cancelCallCount, 0)
    }

    func testDismissSavedSummaryReentersWetReadyWhenCurrentWaterStateIsSubmerged() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let water = FakeWaterStateReader(latestState: .notSubmerged)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
        coordinator.startManual(plan: PreDivePlan(diveMode: .freedive))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertSavedSummary(coordinator)
        water.latestState = .submerged
        coordinator.dismissSavedSummary()

        assertWetReady(coordinator, mode: .scuba)
    }

    func testAdoptedSystemSessionFromSavedSummaryStartsNextDive() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let donor = FakeActionButtonDonor(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, donor: donor)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertSavedSummary(coordinator)

        runtime.emit(.adoptedSystemSession)

        assertRecording(coordinator, source: .systemAutoLaunch, plan: PreDivePlan(diveMode: .scuba))
        XCTAssertEqual(recorder.startedPlans.count, 2)
        XCTAssertEqual(recorder.cancelCallCount, 0)
        XCTAssertEqual(donor.callCount, 2)
    }

    func testActionButtonStartFromSavedSummaryStartsNextDive() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertSavedSummary(coordinator)

        XCTAssertTrue(coordinator.startFromActionButton())

        assertRecording(coordinator, source: .actionButton)
        XCTAssertEqual(recorder.startedPlans.count, 2)
    }

    func testAdoptedSystemSessionFromNoSamplesClearsTheEmptySessionThenStarts() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: false)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertNoSamples(coordinator)

        runtime.emit(.adoptedSystemSession)

        assertRecording(coordinator, source: .systemAutoLaunch)
        XCTAssertEqual(recorder.cancelCallCount, 2)
    }

    func testAdoptedSystemSessionFromStartPersistenceErrorClearsThenStarts() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, startResults: [false, true])
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        assertStartPersistenceError(coordinator, source: .manual)

        runtime.emit(.adoptedSystemSession)

        assertRecording(coordinator, source: .systemAutoLaunch)
        XCTAssertEqual(recorder.cancelCallCount, 1)
    }

    func testAdoptedSystemSessionAfterSaveFailureRetriesSaveBeforeStarting() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true, stopResult: record)
        let sessionStore = FakeDiveSessionStore(saveResults: [false, true])
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, sessionStore: sessionStore)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertSavePersistenceError(coordinator, recordID: record.id)

        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(sessionStore.saveAttempts.map(\.id), [record.id, record.id])
        assertRecording(coordinator, source: .systemAutoLaunch)
    }

    func testAdoptedSystemSessionAfterRepeatedSaveFailureKeepsJournalAndStartsNextDive() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true, stopResult: record)
        let sessionStore = FakeDiveSessionStore(saveResults: [false, false])
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, sessionStore: sessionStore)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        runtime.emit(.adoptedSystemSession)

        XCTAssertEqual(sessionStore.saveAttempts.count, 2)
        XCTAssertEqual(recorder.resetCompletedSessionCallCount, 1)
        XCTAssertEqual(recorder.cancelCallCount, 0, "The unsaved journal must stay on disk for launch recovery.")
        assertRecording(coordinator, source: .systemAutoLaunch)
    }

    func testSubmersionFromSavedSummaryEntersWetReady() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
        let coordinator = makeCoordinator(preferredMode: .freedive, runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))
        assertSavedSummary(coordinator)

        coordinator.receiveWaterState(.submerged)

        assertWetReady(coordinator, mode: .freedive)
    }

    func testAdoptedSystemSessionIsIgnoredWhileRecording() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))

        runtime.emit(.adoptedSystemSession)

        assertRecording(coordinator, source: .manual)
        XCTAssertEqual(recorder.startedPlans.count, 1)
    }

    func testNoSampleAutoLaunchStillDoesNotSave() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: false)
        let sessionStore = FakeDiveSessionStore(saveResults: [true])
        let coordinator = makeCoordinator(
            runtime: runtime,
            recorder: recorder,
            sessionStore: sessionStore
        )
        runtime.emit(.adoptedSystemSession)

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertIdle(coordinator)
        XCTAssertTrue(sessionStore.saveAttempts.isEmpty)
    }

    func testRealRecorderProcessesSampleBeforeInvalidationAndIgnoresLateCallbackAfterReset() async {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let sensorProvider = RetainingManualDepthSensorProvider()
        let profileStore = CountingProfileRecordingStore()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: FakeActionButtonDonor(calls: calls),
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: FakeDiveSessionStore(),
            schedulePersistence: { $0() }
        )
        let acceptedSample = EngineTestFixtures.sample(1, depth: 4)

        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        sensorProvider.emit(acceptedSample)

        XCTAssertTrue(recorder.hasCapturedDepthSample)
        XCTAssertEqual(recorder.currentDepth, acceptedSample.depthMeters, accuracy: 0.001)

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertSavedSummary(coordinator)
        let recordedSampleCount = recorder.samples.count
        let persistedSampleCount = profileStore.appendedSamples.count

        sensorProvider.emitRetained(EngineTestFixtures.sample(2, depth: 18))
        await Task.yield()

        XCTAssertFalse(recorder.isRecording)
        XCTAssertFalse(recorder.hasCapturedDepthSample)
        XCTAssertEqual(recorder.currentDepth, acceptedSample.depthMeters, accuracy: 0.001)
        XCTAssertEqual(recorder.maxDepth, acceptedSample.depthMeters, accuracy: 0.001)
        XCTAssertEqual(recorder.samples.count, recordedSampleCount)
        XCTAssertEqual(profileStore.appendedSamples.count, persistedSampleCount)
    }

    func testManualAndActionButtonNoSampleInvalidationCancelsAndShowsNoSamples() {
        let manualCalls = LifecycleCallLog()
        let manualRuntime = FakeDiveRuntime(calls: manualCalls)
        let manualRecorder = FakeDiveRecorder(calls: manualCalls)
        let manualCoordinator = makeCoordinator(runtime: manualRuntime, recorder: manualRecorder)
        manualCoordinator.startManual(plan: PreDivePlan())
        manualRuntime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(manualRecorder.cancelCallCount, 1)
        assertNoSamples(manualCoordinator)

        let actionCalls = LifecycleCallLog()
        let actionRuntime = FakeDiveRuntime(calls: actionCalls)
        let actionRecorder = FakeDiveRecorder(calls: actionCalls)
        let actionCoordinator = makeCoordinator(runtime: actionRuntime, recorder: actionRecorder)
        actionCoordinator.startFromActionButton()
        actionRuntime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(actionRecorder.cancelCallCount, 1)
        assertNoSamples(actionCoordinator)
    }

    func testAutomaticNoSampleInvalidationCancelsAndReturnsToIdle() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        runtime.emit(.adoptedSystemSession)

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(recorder.cancelCallCount, 1)
        assertIdle(coordinator)
    }

    func testMissingRecordAfterRuntimeInvalidationCancelsAndShowsNoSamples() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true, stopResult: nil)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())

        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        XCTAssertEqual(recorder.stopCallCount, 1)
        XCTAssertEqual(recorder.cancelCallCount, 1)
        assertNoSamples(coordinator)
    }

    func testRealRecorderNoSamplesRetainsArtifactUntilDismissRetry() throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileManager = FailFirstRecorderCleanupFileManager()
        let profileStore = DiveProfileArtifactStore(rootURL: rootURL, fileManager: fileManager)
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = DiveSessionRecorder(
            sensorProvider: RetainingManualDepthSensorProvider(),
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )
        let coordinator = RealDiveSessionCoordinator(
            preferredMode: { .scuba },
            updatePreferredMode: { _ in },
            runtime: runtime,
            recorder: recorder,
            water: FakeWaterStateReader(),
            actionButtonDonor: FakeActionButtonDonor(calls: calls),
            wetReadyExitScheduler: FakeWetReadyExitScheduler(),
            sessionStore: FakeDiveSessionStore(),
            schedulePersistence: { $0() }
        )
        addTeardownBlock {
            try? FileManager.default.removeItem(at: rootURL)
        }

        coordinator.startManual(plan: PreDivePlan(diveMode: .scuba))
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        assertNoSamples(coordinator)
        XCTAssertEqual(try profileStore.loadActiveRecordings().count, 1)

        coordinator.dismissNoSamples()

        assertIdle(coordinator)
        XCTAssertTrue(try profileStore.loadActiveRecordings().isEmpty)
    }

    func testNoSamplesCanBeDismissedIdempotently() {
        let calls = LifecycleCallLog()
        let runtime = FakeDiveRuntime(calls: calls)
        let recorder = FakeDiveRecorder(calls: calls)
        let coordinator = makeCoordinator(runtime: runtime, recorder: recorder)
        coordinator.startManual(plan: PreDivePlan())
        runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

        coordinator.dismissNoSamples()
        coordinator.dismissNoSamples()

        assertIdle(coordinator)
    }

    func testStoreSaveReturnsFalseWhenArtifactFinalizationFails() throws {
        let store = try makeFailingStore()

        XCTAssertFalse(store.save(DiveSessionRecord.largeDebugFixture(sampleCount: 1)))
        XCTAssertTrue(store.sessions.isEmpty)
    }

    private func makeFailingStore() throws -> DiveSessionStore {
        let userDefaultsSuite = "RealDiveSessionCoordinatorTests.\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: userDefaultsSuite))
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: false)
        try Data("file-not-directory".utf8).write(to: rootURL)
        addTeardownBlock {
            userDefaults.removePersistentDomain(forName: userDefaultsSuite)
            try? FileManager.default.removeItem(at: rootURL)
        }
        return DiveSessionStore(
            userDefaults: userDefaults,
            recordsStorageURL: rootURL.appendingPathComponent("records.json")
        )
    }

    private func signals(water: WaterSubmersionState, elapsed: TimeInterval) -> RecordingPageSignals {
        RecordingPageSignals(
            waterState: water,
            elapsedTime: elapsed,
            liveDepthSignal: water == .notSubmerged ? .stale : .live,
            freediveState: nil,
            safetyStopStatus: .notRequired
        )
    }

    private func makeCoordinator(
        preferredMode: DiveMode = .scuba,
        runtime: FakeDiveRuntime,
        recorder: FakeDiveRecorder,
        water: FakeWaterStateReader? = nil,
        donor: FakeActionButtonDonor? = nil,
        preference: FakeDiveModePreference? = nil,
        scheduler: FakeWetReadyExitScheduler? = nil,
        sessionStore: FakeDiveSessionStore? = nil,
        haptics: RecordedDiveHaptics? = nil,
        pageScheduler: ManualPageReturnScheduler? = nil
    ) -> RealDiveSessionCoordinator {
        let preference = preference ?? FakeDiveModePreference(mode: preferredMode)
        return RealDiveSessionCoordinator(
            preferredMode: { preference.mode },
            updatePreferredMode: preference.update,
            runtime: runtime,
            recorder: recorder,
            water: water ?? FakeWaterStateReader(),
            actionButtonDonor: donor ?? FakeActionButtonDonor(calls: LifecycleCallLog()),
            wetReadyExitScheduler: scheduler ?? FakeWetReadyExitScheduler(),
            sessionStore: sessionStore ?? FakeDiveSessionStore(),
            schedulePersistence: { $0() },
            haptics: haptics ?? RecordedDiveHaptics(),
            pageReturnScheduler: pageScheduler ?? ManualPageReturnScheduler()
        )
    }

    private func assertIdle(
        _ coordinator: RealDiveSessionCoordinator,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .idle = coordinator.phase else {
            return XCTFail("Expected idle phase, received \(coordinator.phase)", file: file, line: line)
        }
    }

    private func assertRecording(
        _ coordinator: RealDiveSessionCoordinator,
        source: RealDiveStartSource,
        plan expectedPlan: PreDivePlan? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .recording(actualSource, actualPlan) = coordinator.phase else {
            return XCTFail("Expected recording phase, received \(coordinator.phase)", file: file, line: line)
        }
        XCTAssertEqual(actualSource, source, file: file, line: line)
        if let expectedPlan {
            XCTAssertEqual(actualPlan, expectedPlan, file: file, line: line)
        }
    }

    private func assertWetReady(
        _ coordinator: RealDiveSessionCoordinator,
        mode: DiveMode,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .wetReady(actualMode) = coordinator.phase else {
            return XCTFail("Expected wet-ready phase, received \(coordinator.phase)", file: file, line: line)
        }
        XCTAssertEqual(actualMode, mode, file: file, line: line)
    }

    @discardableResult
    private func assertSavedSummary(
        _ coordinator: RealDiveSessionCoordinator,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> DiveSessionRecord {
        guard case let .savedSummary(record) = coordinator.phase else {
            XCTFail("Expected saved-summary phase, received \(coordinator.phase)", file: file, line: line)
            return DiveSessionRecord.largeDebugFixture(sampleCount: 1)
        }
        return record
    }

    private func assertSavePersistenceError(
        _ coordinator: RealDiveSessionCoordinator,
        recordID: UUID,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .savePersistenceError(record) = coordinator.phase else {
            return XCTFail("Expected save-persistence-error phase", file: file, line: line)
        }
        XCTAssertEqual(record.id, recordID, file: file, line: line)
    }

    private func assertNoSamples(
        _ coordinator: RealDiveSessionCoordinator,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .noSamples = coordinator.phase else {
            return XCTFail("Expected no-samples phase, received \(coordinator.phase)", file: file, line: line)
        }
    }

    private func assertStartPersistenceError(
        _ coordinator: RealDiveSessionCoordinator,
        source: RealDiveStartSource,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .startPersistenceError(actualSource) = coordinator.phase else {
            return XCTFail("Expected start-persistence-error phase", file: file, line: line)
        }
        XCTAssertEqual(actualSource, source, file: file, line: line)
        XCTAssertTrue(coordinator.phase.presentsRecordingFlow, file: file, line: line)
    }

    private func assertAwaitingRuntimeInvalidation(
        _ coordinator: RealDiveSessionCoordinator,
        source: RealDiveStartSource,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .awaitingRuntimeInvalidation(actualSource) = coordinator.phase else {
            return XCTFail("Expected awaiting-runtime-invalidation phase", file: file, line: line)
        }
        XCTAssertEqual(actualSource, source, file: file, line: line)
        XCTAssertTrue(coordinator.phase.presentsRecordingFlow, file: file, line: line)
    }
}

@MainActor
private final class FakeDiveModePreference {
    var mode: DiveMode
    private(set) var updates: [DiveMode] = []

    init(mode: DiveMode) {
        self.mode = mode
    }

    func update(_ mode: DiveMode) {
        self.mode = mode
        updates.append(mode)
    }
}

@MainActor
private final class FakeWetReadyExitScheduler: WetReadyExitScheduling {
    private var action: (@MainActor () -> Void)?
    private(set) var cancelCallCount = 0

    func schedule(_ action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    func cancel() {
        if action != nil {
            cancelCallCount += 1
        }
        action = nil
    }

    func fire() {
        let pendingAction = action
        action = nil
        pendingAction?()
    }
}

@MainActor
private final class FakeDiveSessionStore: DiveSessionPersisting {
    private var saveResults: [Bool]
    private(set) var saveAttempts: [DiveSessionRecord] = []

    init(saveResults: [Bool] = [true]) {
        self.saveResults = saveResults
    }

    func save(_ session: DiveSessionRecord) -> Bool {
        saveAttempts.append(session)
        return saveResults.isEmpty ? true : saveResults.removeFirst()
    }
}

@MainActor
private final class LifecycleCallLog {
    private(set) var values: [String] = []

    func append(_ value: String) {
        values.append(value)
    }
}

@MainActor
private final class FakeDiveRuntime: DiveRuntimeSessionControlling {
    var onEvent: ((DiveRuntimeEvent) -> Void)?

    private let calls: LifecycleCallLog
    private var startResults: [Bool]
    private(set) var startManualCallCount = 0
    private(set) var invalidateCallCount = 0

    init(calls: LifecycleCallLog, startResults: [Bool] = [true]) {
        self.calls = calls
        self.startResults = startResults
    }

    func startManualSession() -> Bool {
        startManualCallCount += 1
        calls.append("runtime.startManual")
        return startResults.isEmpty ? true : startResults.removeFirst()
    }

    func adoptSystemSession(_ session: WKExtendedRuntimeSession) {}

    func invalidate() {
        invalidateCallCount += 1
        calls.append("runtime.invalidate")
    }

    func emit(_ event: DiveRuntimeEvent) {
        onEvent?(event)
    }
}

@MainActor
private final class CoordinatorRuntimeAdapterFactory: DiveRuntimeSessionAdapterFactory {
    private var manualAdapters: [CoordinatorRuntimeAdapter]
    private var adoptedAdapters: [CoordinatorRuntimeAdapter]

    init(
        manualAdapters: [CoordinatorRuntimeAdapter],
        adoptedAdapters: [CoordinatorRuntimeAdapter]
    ) {
        self.manualAdapters = manualAdapters
        self.adoptedAdapters = adoptedAdapters
    }

    func makeManualAdapter() -> DiveRuntimeSessionAdapter {
        manualAdapters.removeFirst()
    }

    func makeAdapter(for session: WKExtendedRuntimeSession) -> DiveRuntimeSessionAdapter {
        adoptedAdapters.removeFirst()
    }
}

@MainActor
private final class CoordinatorRuntimeAdapter: DiveRuntimeSessionAdapter {
    enum Call: Equatable {
        case setDelegate
        case start
        case invalidate
    }

    weak var delegate: DiveRuntimeSessionAdapterDelegate? {
        didSet { calls.append(.setDelegate) }
    }

    private(set) var calls: [Call] = []

    func start() {
        calls.append(.start)
    }

    func invalidate() {
        calls.append(.invalidate)
    }

    func emitInvalidation(
        reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    ) {
        delegate?.runtimeAdapter(self, didInvalidateWith: reason, error: error)
    }
}

@MainActor
private final class FakeDiveRecorder: DiveSessionRecording {
    var elapsedTime: TimeInterval
    var currentDepth: Double
    var hasCapturedDepthSample: Bool

    private let calls: LifecycleCallLog
    private let stopResult: DiveSessionRecord?
    private var startResults: [Bool]
    private var cancelResults: [Bool]
    private(set) var startedPlans: [PreDivePlan] = []
    private(set) var stopCallCount = 0
    private(set) var cancelCallCount = 0
    private(set) var resetCompletedSessionCallCount = 0

    init(
        calls: LifecycleCallLog,
        elapsedTime: TimeInterval = 0,
        currentDepth: Double = 0,
        hasCapturedDepthSample: Bool = false,
        stopResult: DiveSessionRecord? = DiveSessionRecord.largeDebugFixture(sampleCount: 1),
        startResults: [Bool] = [true],
        cancelResults: [Bool] = [true]
    ) {
        self.calls = calls
        self.elapsedTime = elapsedTime
        self.currentDepth = currentDepth
        self.hasCapturedDepthSample = hasCapturedDepthSample
        self.stopResult = stopResult
        self.startResults = startResults
        self.cancelResults = cancelResults
    }

    func startSession(plan: PreDivePlan) -> Bool {
        startedPlans.append(plan)
        calls.append("recorder.start")
        return startResults.isEmpty ? true : startResults.removeFirst()
    }

    func stopSession() -> DiveSessionRecord? {
        stopCallCount += 1
        calls.append("recorder.stop")
        return stopResult
    }

    func cancelSession() -> Bool {
        cancelCallCount += 1
        calls.append("recorder.cancel")
        return cancelResults.isEmpty ? true : cancelResults.removeFirst()
    }

    func resetCompletedSession() {
        resetCompletedSessionCallCount += 1
        calls.append("recorder.resetCompleted")
    }
}

@MainActor
private final class RetainingManualDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)? {
        didSet {
            if let onSample {
                retainedCallback = onSample
            }
        }
    }

    private var retainedCallback: ((DepthSample) -> Void)?

    func start() {}

    func stop() {}

    func emit(_ sample: DepthSample) {
        onSample?(sample)
    }

    func emitRetained(_ sample: DepthSample) {
        retainedCallback?(sample)
    }
}

private final class CountingProfileRecordingStore: DiveProfileRecordingStoring {
    private(set) var appendedSamples: [DepthSample] = []
    private(set) var clearCallCount = 0

    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws {}

    func append(_ sample: DepthSample, to sessionID: UUID) throws {
        appendedSamples.append(sample)
    }

    func clearActiveRecording(sessionID: UUID) throws {
        clearCallCount += 1
    }
}

private final class FailFirstRecorderCleanupFileManager: FileManager {
    private var hasFailedActiveCleanup = false

    override func removeItem(at URL: URL) throws {
        if !hasFailedActiveCleanup,
           ["active-recording.json", "recording.ndjson"].contains(URL.lastPathComponent) {
            hasFailedActiveCleanup = true
            throw CocoaError(.fileWriteNoPermission)
        }

        try super.removeItem(at: URL)
    }
}

@MainActor
private final class FakeWaterStateReader: WaterSubmersionStateReading {
    var latestState: WaterSubmersionState

    init(latestState: WaterSubmersionState = .unknown) {
        self.latestState = latestState
    }
}

@MainActor
private final class FakeActionButtonDonor: DiveActionButtonDonating {
    private let calls: LifecycleCallLog
    private let shouldFail: Bool
    private(set) var callCount = 0

    init(calls: LifecycleCallLog, shouldFail: Bool = false) {
        self.calls = calls
        self.shouldFail = shouldFail
    }

    func donateDiveAction() {
        callCount += 1
        calls.append(shouldFail ? "donor.failed" : "donor.donated")
    }
}
