import XCTest
@testable import DivenaryWatchApp

/// The one-line hint under a real recording, for each phase the page model reports.
final class RecordingHintTests: XCTestCase {
    @MainActor
    func testRemovedPlanClearsAllSelectedMetadataButKeepsMode() {
        let selected = PreDivePlan(sourcePlanLocalId: "executed", title: "Old reef", diveMode: .freedive, siteName: "Old site")
        XCTAssertEqual(HomePlanSelection.validated(selected, plannedDives: []), PreDivePlan(diveMode: .freedive))
        XCTAssertNil(HomePlanSelection.startPlan(selected, mode: .scuba, plannedDives: []).sourcePlanLocalId)
    }

    @MainActor
    func testManualStartReadsCurrentPlanAndModeSwitchDropsSelection() {
        let current = WatchPlannedDive(localId: "p1", title: "Updated", siteName: nil, diveMode: .scuba,
                                      entryStyle: nil, plannedAt: nil, plannedMaxDepthMeters: 12,
                                      plannedDurationMinutes: nil, gasLabel: nil, buddyIds: [], gearIds: nil,
                                      tags: [], notes: nil)
        let stale = PreDivePlan(sourcePlanLocalId: "p1", title: "Old", diveMode: .scuba)
        XCTAssertEqual(HomePlanSelection.startPlan(stale, mode: .scuba, plannedDives: [current]), current.preDivePlan)
        XCTAssertEqual(HomePlanSelection.startPlan(stale, mode: .freedive, plannedDives: [current]), PreDivePlan(diveMode: .freedive))
        XCTAssertEqual(HomePlanSelection.instructions, String(localized: "Select a plan for starts from Home. Tap again to clear."))
    }

    func testWetReadyUnknownStatusStillOffersConditionalActionButtonAndHomeExit() {
        let ultra = WetReadyStartGuidance(autoLaunchStatus: .unknown, hasActionButton: true)
        XCTAssertEqual(ultra.text, String(localized: "If you assigned Divenary to the Action Button, press it to start recording."))
        for status in [DepthAutoLaunchStatus.inactive, .unknown] {
            let guidance = WetReadyStartGuidance(autoLaunchStatus: status, hasActionButton: false)
            XCTAssertTrue(guidance.showsHomeButton)
            XCTAssertEqual(guidance.text, String(localized: "Start recording from Home."))
        }
        XCTAssertEqual(WetReadyStartGuidance.notRecordingText, String(localized: "Not recording yet"))
    }

    func testWetReadyActiveAutoLaunchStillOffersHomeAndNotRecordingLine() {
        for hasActionButton in [true, false] {
            let guidance = WetReadyStartGuidance(autoLaunchStatus: .active, hasActionButton: hasActionButton)
            XCTAssertTrue(guidance.showsHomeButton)
            XCTAssertEqual(guidance.text, String(localized: "Recording starts when watchOS starts the dive session."))
        }
        XCTAssertEqual(WetReadyStartGuidance.notRecordingText, String(localized: "Not recording yet"))
    }

    func testCrownHintsNameForwardAndBackInsteadOfPromisingACycle() {
        XCTAssertEqual(hint(page: .live, availability: .available, water: .notSubmerged, hasActionButton: false).text,
                       String(localized: "Crown forward ▸ Details"))
        XCTAssertEqual(hint(page: .details, availability: .available, water: .notSubmerged, hasActionButton: false).text,
                       String(localized: "Crown back ▸ Live"))
    }

    func testUnderwaterNamesTheNextActionPageAndThePosition() {
        let live = hint(page: .live, availability: .notAtSurface, water: .submerged)
        let details = hint(page: .details, availability: .notAtSurface, water: .submerged)

        XCTAssertEqual(live.kind, .nextPage(.details, input: .actionButton))
        XCTAssertEqual(live.pageIndex, 0)
        XCTAssertEqual(live.pageCount, 2)
        XCTAssertEqual(details.kind, .nextPage(.live, input: .actionButton))
        XCTAssertEqual(details.pageIndex, 1)
        XCTAssertFalse(live.showsWaterLockNote)
    }

    func testSurfaceUnderTheMinimumCountsDownAndShowsTheWaterLockNote() {
        let hint = hint(page: .live, availability: .availableIn(seconds: 125), water: .notSubmerged)

        XCTAssertEqual(hint.kind, .endAvailableIn(seconds: 125))
        XCTAssertTrue(hint.showsWaterLockNote)
        XCTAssertEqual(DiveFormatters.countdown(seconds: 125), "2:05")
    }

    func testEligibleSurfacePointsToTheEndPageAndTheEndPageAsksForAPress() {
        let cycle: [RecordingPage] = [.live, .details, .end]
        let details = hint(page: .details, pages: cycle, availability: .available, water: .notSubmerged)
        let end = hint(page: .end, pages: cycle, availability: .available, water: .notSubmerged)

        XCTAssertEqual(details.kind, .nextPage(.end, input: .actionButton))
        XCTAssertEqual(details.pageCount, 3)
        XCTAssertEqual(details.text, String(localized: "Action ▸ End page"))
        XCTAssertEqual(end.kind, .pressToEnd)
        XCTAssertEqual(end.pageIndex, 2)
    }

    /// The hint names what the next press does: from Live that is Details, even once ending is
    /// allowed, so the chip never promises the End page one press too early.
    func testEligibleSurfaceOnLiveNamesDetailsAsTheNextPress() {
        let live = hint(page: .live, pages: [.live, .details, .end], availability: .available, water: .notSubmerged)

        XCTAssertEqual(live.kind, .nextPage(.details, input: .actionButton))
        XCTAssertEqual(live.pageIndex, 0)
        XCTAssertEqual(live.pageCount, 3)
        XCTAssertTrue(live.showsWaterLockNote)
    }

    func testUnknownWaterStateHidesTheWaterLockNote() {
        let hint = hint(page: .live, availability: .notAtSurface, water: .unknown)

        XCTAssertFalse(hint.showsWaterLockNote)
    }

    func testWatchWithoutTheActionButtonDescribesTheCrownAndNeverTheEnd() {
        let surface = hint(
            page: .live,
            availability: .availableIn(seconds: 30),
            water: .notSubmerged,
            hasActionButton: false
        )
        let details = hint(
            page: .details,
            pages: [.live, .details, .end],
            availability: .available,
            water: .notSubmerged,
            hasActionButton: false
        )

        XCTAssertEqual(surface.kind, .nextPage(.details, input: .crown))
        XCTAssertEqual(details.kind, .nextPage(.live, input: .crown))
        XCTAssertEqual(details.pageCount, 2)
        XCTAssertTrue(surface.showsWaterLockNote)
    }

    func testRejectedPressReplacesTheHintBriefly() {
        let hint = hint(page: .live, availability: .notAtSurface, water: .submerged, showsRejection: true)

        XCTAssertEqual(hint.kind, .endRejected)
    }

    private func hint(
        page: RecordingPage,
        pages: [RecordingPage] = [.live, .details],
        availability: RecordingEndAvailability,
        water: WaterSubmersionState,
        hasActionButton: Bool = true,
        showsRejection: Bool = false
    ) -> RecordingHint {
        RecordingHint.make(
            page: page,
            pages: pages,
            endAvailability: availability,
            waterState: water,
            hasActionButton: hasActionButton,
            showsRejection: showsRejection
        )
    }
}
