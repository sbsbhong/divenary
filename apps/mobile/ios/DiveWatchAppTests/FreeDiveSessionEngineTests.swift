import XCTest
@testable import DiveWatchApp

final class FreeDiveSessionEngineTests: XCTestCase {
    func testStartingSessionCreatesNoSegmentUntilMeaningfulDescent() {
        let engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)
        XCTAssertNil(engine.snapshot.activeSegment)
    }
}
