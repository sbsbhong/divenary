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

    func testSwitchPageNamesTheTypeTheNextPressSwitchesTo() {
        let pages: [RecordingPage] = [.live, .details, .switchMode]
        let details = hint(page: .details, pages: pages, availability: .notAtSurface, water: .submerged)
        let toScuba = hint(page: .switchMode, pages: pages, availability: .notAtSurface, water: .submerged,
                           currentMode: .freedive)
        let toFreedive = hint(page: .switchMode, pages: pages, availability: .notAtSurface, water: .submerged)

        XCTAssertEqual(details.kind, .nextPage(.switchMode, input: .actionButton))
        XCTAssertEqual(details.text, String(localized: "Action ▸ Switch type \(2)/\(3)"))
        XCTAssertEqual(toScuba.kind, .pressToSwitch(.scuba))
        XCTAssertEqual(toScuba.pageIndex, 2)
        XCTAssertEqual(toScuba.text, String(localized: "Action ▸ Switch to scuba"))
        XCTAssertEqual(toFreedive.text, String(localized: "Action ▸ Switch to freediving"))
    }

    func testCrownHintNeverOffersTheSwitchPage() {
        let pages: [RecordingPage] = [.live, .details, .switchMode]
        let details = hint(page: .details, pages: pages, availability: .notAtSurface, water: .submerged,
                           hasActionButton: false)

        XCTAssertEqual(details.kind, .nextPage(.live, input: .crown))
        XCTAssertEqual(details.pageCount, 2)
        XCTAssertEqual(details.text, String(localized: "Crown back ▸ Live"))
    }

    func testCrownStepsCountFractionalUpdatesAsTheyAddUp() {
        var counter = CrownDetentCounter()
        // A slow forward turn arrives as small fractions; each alone used to round to no step.
        XCTAssertEqual([0.1, 0.25, 0.4].map { counter.consume($0) }, [0, 0, 0])
        XCTAssertEqual(counter.consume(0.6), 1)
        XCTAssertEqual(counter.consume(1.0), 0)
        XCTAssertEqual(counter.consume(2.4), 1)
        XCTAssertEqual(counter.consume(0.2), -2)
        XCTAssertEqual(counter.consume(.nan), 0)
        XCTAssertEqual(counter.appliedStep, 0)
    }

    func testRejectedSwitchSaysTheDiveHasAlreadyStarted() {
        let hint = hint(page: .live, availability: .notAtSurface, water: .submerged, showsRejection: true,
                        rejection: .modeSwitchUnavailable)

        XCTAssertEqual(hint.kind, .switchRejected)
        XCTAssertEqual(hint.text, String(localized: "Already dived · no switch"))
    }

    /// The End page chip carries its text too (DECISIONS D12); only a refused press turns it white.
    func testOnlyARefusedPressEmphasizesTheHintChip() {
        let end = hint(page: .end, pages: [.live, .details, .end], availability: .available, water: .notSubmerged)
        XCTAssertEqual(end.text, String(localized: "Press to end & save"))
        XCTAssertFalse(end.isRejection)
        XCTAssertFalse(hint(page: .live, availability: .notAtSurface, water: .submerged).isRejection)
        XCTAssertTrue(hint(page: .live, availability: .notAtSurface, water: .submerged, showsRejection: true).isRejection)
        XCTAssertTrue(hint(page: .live, availability: .notAtSurface, water: .submerged, showsRejection: true,
                           rejection: .modeSwitchUnavailable).isRejection)
    }

    /// Paging back with the crown reverses the page motion; the Action Button always pages forward,
    /// and automatic returns do not slide.
    func testPageMotionFollowsTheDiversInput() {
        let back = RecordingPageMotion(change: RecordingPageChange(page: .live, reason: .crown), crownDirection: -1)
        XCTAssertTrue(back.userInitiated)
        XCTAssertFalse(back.forward)
        let crownForward = RecordingPageMotion(change: RecordingPageChange(page: .details, reason: .crown), crownDirection: 1)
        XCTAssertTrue(crownForward.forward)
        let press = RecordingPageMotion(change: RecordingPageChange(page: .live, reason: .actionButton), crownDirection: -1)
        XCTAssertTrue(press.userInitiated)
        XCTAssertTrue(press.forward)
        let idle = RecordingPageMotion(change: RecordingPageChange(page: .live, reason: .idleTimeout), crownDirection: -1)
        XCTAssertFalse(idle.userInitiated)
        XCTAssertFalse(RecordingPageMotion(change: nil, crownDirection: 0).userInitiated)
    }

    func testAuthorizedGaugeUsesSixMeterRangeAndCleanSparseTicks() {
        let scale = RecordingGaugeScale(maximumDepthMeters: 6, rangeMeters: 30)
        XCTAssertEqual(scale.upperBound, 6)
        XCTAssertEqual(scale.ticks, [0, 2, 4, 6])
        XCTAssertEqual(scale.displayedDepth(8), 6)
        XCTAssertNil(scale.displayedDepth(nil))
        XCTAssertNil(scale.displayedDepth(.nan))
    }

    func testGaugeFallbackMinimumAndFractionalAuthorizationNeverInventRange() {
        XCTAssertEqual(RecordingGaugeScale(maximumDepthMeters: nil, rangeMeters: 30).upperBound, 30)
        XCTAssertEqual(RecordingGaugeScale(maximumDepthMeters: .nan, rangeMeters: 30).upperBound, 30)
        let fractional = RecordingGaugeScale(maximumDepthMeters: 5.7, rangeMeters: 30)
        XCTAssertEqual(fractional.upperBound, 5.7)
        XCTAssertEqual(fractional.ticks, [0, 2, 4])
        XCTAssertEqual(fractional.displayedDepth(6), 5.7)
        let shallow = RecordingGaugeScale(maximumDepthMeters: 0.5, rangeMeters: 30)
        XCTAssertEqual(shallow.upperBound, 1)
        XCTAssertTrue(shallow.ticks.allSatisfy { $0 <= 0.5 })
        XCTAssertEqual(shallow.displayedDepth(1), 0.5)
        XCTAssertEqual(RecordingGaugeScale(maximumDepthMeters: 100, rangeMeters: 60).upperBound, 40)
    }

    func testGaugeRangeFollowsTheDiveWithinTheAuthorizedLimit() {
        // A 40 m sensor limit no longer pins the rail to 0-40 m from the start of the dive.
        let shallowDive = RecordingGaugeScale(maximumDepthMeters: 40, rangeMeters: 30)
        XCTAssertEqual(shallowDive.upperBound, 30)
        XCTAssertEqual(shallowDive.ticks, [0, 10, 20, 30])
        XCTAssertEqual(shallowDive.displayLimit, 40)

        let deeperDive = RecordingGaugeScale(maximumDepthMeters: 40, rangeMeters: 40)
        XCTAssertEqual(deeperDive.upperBound, 40)
        XCTAssertEqual(deeperDive.ticks, [0, 20, 40])
        XCTAssertEqual(RecordingGaugeScale(maximumDepthMeters: 40, rangeMeters: 50).upperBound, 40)

        // The recommended stop page asks for about 10 m so the 3-6 m zone stands out.
        let stop = RecordingGaugeScale(maximumDepthMeters: 40, rangeMeters: 10)
        XCTAssertEqual(stop.upperBound, 10)
        XCTAssertEqual(stop.ticks, [0, 5, 10])
    }

    func testEndGuidanceNamesTheAvailableHardwarePath() {
        XCTAssertEqual(RecordingEndGuidance(hasActionButton: true).text,
                       String(localized: "Press Action Button\nEnd & save"))
        XCTAssertEqual(RecordingEndGuidance(hasActionButton: false).text,
                       String(localized: "Water Lock off\nEnd & save"))
        let fallback = hint(page: .end, pages: [.live, .details, .end], availability: .available,
                            water: .notSubmerged, hasActionButton: false)
        XCTAssertEqual(fallback.kind, .waterLockToEnd)
        XCTAssertNotEqual(RecordingEndGuidance(hasActionButton: true).symbol,
                          RecordingEndGuidance(hasActionButton: false).symbol)
    }

    /// DECISIONS D20: without the Action Button the End page says to turn off Water Lock in large
    /// type, so the instrument's bottom slot drops the Water Lock line there and the chip keeps its
    /// dots only. With the Action Button the chip names the press and the line stays, as the other
    /// way to end at the surface.
    func testEndPageSaysTheWaterLockLineOnlyOnce() {
        let cycle: [RecordingPage] = [.live, .details, .end]
        let withoutButton = hint(page: .end, pages: cycle, availability: .available, water: .notSubmerged,
                                 hasActionButton: false)
        XCTAssertEqual(withoutButton.kind, .waterLockToEnd)
        XCTAssertNil(withoutButton.text)
        XCTAssertEqual(withoutButton.pageIndex, 2)
        XCTAssertEqual(withoutButton.pageCount, 3)
        XCTAssertTrue(withoutButton.showsWaterLockNote)
        XCTAssertFalse(withoutButton.showsWaterLockLine(on: .end))
        XCTAssertEqual(RecordingEndGuidance(hasActionButton: false).text,
                       String(localized: "Water Lock off\nEnd & save"))

        let withButton = hint(page: .end, pages: cycle, availability: .available, water: .notSubmerged)
        XCTAssertEqual(withButton.kind, .pressToEnd)
        XCTAssertEqual(withButton.text, String(localized: "Press to end & save"))
        XCTAssertTrue(withButton.showsWaterLockLine(on: .end))
        // Back in the water the line goes, with or without the button.
        let submergedWithButton = hint(page: .end, pages: cycle, availability: .available, water: .submerged)
        XCTAssertFalse(submergedWithButton.showsWaterLockLine(on: .end))

        // A refused press on the End page still shows its note; the line keeps to the watch's rule.
        let refused = hint(page: .end, pages: cycle, availability: .available, water: .notSubmerged,
                           hasActionButton: false, showsRejection: true)
        XCTAssertEqual(refused.text, String(localized: "End not available"))
        XCTAssertFalse(refused.showsWaterLockLine(on: .end))
        let refusedWithButton = hint(page: .end, pages: cycle, availability: .available, water: .notSubmerged,
                                     showsRejection: true)
        XCTAssertEqual(refusedWithButton.text, String(localized: "End not available"))
        XCTAssertTrue(refusedWithButton.showsWaterLockLine(on: .end))

        // Every other page keeps the line out of the water, and no page shows it underwater.
        let details = hint(page: .details, pages: cycle, availability: .available, water: .notSubmerged)
        XCTAssertTrue(details.showsWaterLockLine(on: .details))
        let underwater = hint(page: .live, availability: .notAtSurface, water: .submerged)
        XCTAssertFalse(underwater.showsWaterLockLine(on: .live))
    }

    func testChartSummaryDescribesDepthRangeAndUnknownWithoutMeasurementCounts() {
        XCTAssertEqual(DiveFormatters.profileAccessibilitySummary(samples: []),
                       String(localized: "Depth chart: --"))
        let samples = [EngineTestFixtures.sample(0, depth: 2), EngineTestFixtures.sample(1, depth: 6)]
        XCTAssertEqual(DiveFormatters.profileAccessibilitySummary(samples: samples),
                       String(localized: "Depth chart: \(DiveFormatters.depth(2)) to \(DiveFormatters.depth(6))"))
    }

    private func hint(
        page: RecordingPage,
        pages: [RecordingPage] = [.live, .details],
        availability: RecordingEndAvailability,
        water: WaterSubmersionState,
        hasActionButton: Bool = true,
        showsRejection: Bool = false,
        rejection: DiveActionRejection? = nil,
        currentMode: DiveMode = .scuba
    ) -> RecordingHint {
        RecordingHint.make(
            page: page,
            pages: pages,
            endAvailability: availability,
            waterState: water,
            hasActionButton: hasActionButton,
            showsRejection: showsRejection,
            rejection: rejection,
            currentMode: currentMode
        )
    }
}
