import XCTest
@testable import DivenaryWatchApp

final class FreeDiveSessionEngineTests: XCTestCase {
    func testStartingSessionCreatesNoSegmentUntilMeaningfulDescent() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        engine.append(EngineTestFixtures.sample(0, depth: 0.2))
        engine.append(EngineTestFixtures.sample(1, depth: 0.6))
        engine.append(EngineTestFixtures.sample(2, depth: 0.7))

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)
    }

    func testSustainedDescentStartsDiveOne() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        [0.2, 1.3, 1.6, 2.1, 2.8].enumerated().forEach { offset, depth in
            engine.append(EngineTestFixtures.sample(TimeInterval(offset), depth: depth))
        }

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.activeSegment?.index, 1)
    }

    func testSparseAboveThresholdSpikeDoesNotStartDive() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        engine.append(EngineTestFixtures.sample(0, depth: 0.2))
        engine.append(EngineTestFixtures.sample(3, depth: 1.3))

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)

        engine.append(EngineTestFixtures.sample(4, depth: 1.6))

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)

        engine.append(EngineTestFixtures.sample(5, depth: 2.1))

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)

        engine.append(EngineTestFixtures.sample(6, depth: 2.8))

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.activeSegment?.sampleStartIndex, 0)
    }

    func testRapidAboveThresholdSamplesDoNotBypassSustainedDuration() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0.0, 0.2), (1.0, 1.3), (1.5, 1.6), (2.0, 2.1), (2.5, 2.8)] {
            engine.append(EngineTestFixtures.sample(time, depth: depth))
        }

        XCTAssertEqual(engine.state, .surfaceReady)
        XCTAssertEqual(engine.snapshot.diveCount, 0)

        engine.append(EngineTestFixtures.sample(4, depth: 3.0))

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.activeSegment?.sampleStartIndex, 0)
    }

    func testActiveDiveSnapshotIsStableAcrossRepeatedReads() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        [0.2, 1.3, 1.6, 2.1, 2.8].enumerated().forEach { offset, depth in
            engine.append(EngineTestFixtures.sample(TimeInterval(offset), depth: depth))
        }

        let first = engine.snapshot
        let second = engine.snapshot

        XCTAssertEqual(first, second)
        XCTAssertEqual(first.activeSegment?.id, second.activeSegment?.id)
    }

    func testReturningToSurfaceClosesDiveOne() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0, 0.1), (1, 1.3), (2, 2.0), (3, 5.0), (4, 6.0), (10, 0.7), (14, 0.5)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.state, .surfaceInterval)
        XCTAssertEqual(engine.snapshot.segments.count, 1)
        XCTAssertEqual(engine.snapshot.segments[0].index, 1)
    }

    func testTransientSurfaceSampleDoesNotCloseActiveDive() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0, 0.1), (1, 1.3), (2, 2.0), (3, 5.0), (4, 6.0), (10, 0.7), (13, 0.5)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.segments.count, 0)
        XCTAssertEqual(engine.snapshot.activeSegment?.index, 1)
    }

    func testSecondDescentCreatesDiveTwoInSameSession() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0, 0.1), (1, 1.3), (2, 2.0), (3, 5.0), (4, 6.0), (10, 0.7), (14, 0.5), (20, 1.4), (21, 2.5), (23, 8.0)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.state, .diveActive)
        XCTAssertEqual(engine.snapshot.segments.count, 1)
        XCTAssertEqual(engine.snapshot.activeSegment?.index, 2)
    }

    func testSurfaceIntervalTimerUsesPreviousSegmentEnd() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0, 0.1), (1, 1.3), (2, 2.0), (3, 5.0), (4, 6.0), (10, 0.7), (14, 0.5)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        XCTAssertEqual(engine.surfaceInterval(at: EngineTestFixtures.date(44)), 30)
    }

    func testShallowNoiseDoesNotCreateFakeDive() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for second in 0...20 {
            let depth = second.isMultiple(of: 2) ? 0.9 : 1.05
            engine.append(EngineTestFixtures.sample(TimeInterval(second), depth: depth))
        }

        XCTAssertEqual(engine.snapshot.diveCount, 0)
        XCTAssertEqual(engine.state, .surfaceReady)
    }

    func testManualEndFinalizesOpenSegment() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0, 0.1), (1, 1.3), (2, 2.0), (3, 5.0), (4, 6.0)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }

        let session = engine.finish(at: EngineTestFixtures.date(9))

        XCTAssertEqual(session.diveCount, 1)
        XCTAssertEqual(session.segments[0].endTime, EngineTestFixtures.date(9))
    }

    func testAppendAfterSummaryDoesNotChangeSnapshot() {
        var engine = FreeDiveSessionEngine(startedAt: EngineTestFixtures.start)
        for (time, depth) in [(0, 0.1), (1, 1.3), (2, 2.0), (3, 5.0), (4, 6.0)] {
            engine.append(EngineTestFixtures.sample(TimeInterval(time), depth: depth))
        }
        _ = engine.finish(at: EngineTestFixtures.date(9))
        let summary = engine.snapshot

        engine.append(EngineTestFixtures.sample(10, depth: 30.0))

        XCTAssertEqual(engine.state, .summary)
        XCTAssertEqual(engine.snapshot, summary)
        XCTAssertEqual(engine.snapshot.currentDepthMeters, summary.currentDepthMeters)
    }
}
