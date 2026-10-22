import XCTest
@testable import DivenaryWatchApp

/// The one-line hint under a real recording, for each phase the page model reports.
final class RecordingHintTests: XCTestCase {
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

        XCTAssertEqual(details.kind, .endPageInCycle)
        XCTAssertEqual(details.pageCount, 3)
        XCTAssertEqual(end.kind, .pressToEnd)
        XCTAssertEqual(end.pageIndex, 2)
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
