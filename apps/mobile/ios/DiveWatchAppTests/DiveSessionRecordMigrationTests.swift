import XCTest
@testable import DiveWatchApp

final class DiveSessionRecordMigrationTests: XCTestCase {
    func testOldFreediveSessionAdaptsToOneSegment() {
        let samples = [
            EngineTestFixtures.sample(0, depth: 0),
            EngineTestFixtures.sample(4, depth: 12),
            EngineTestFixtures.sample(20, depth: 0.4)
        ]
        let old = DiveSession(
            diveMode: .freedive,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(20),
            samples: samples
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .freedive(session) = record.payload else {
            return XCTFail("Expected freedive payload")
        }
        XCTAssertEqual(session.diveCount, 1)
        XCTAssertEqual(session.segments.count, 1)
        XCTAssertEqual(session.maxDepthMeters, 12)
    }

    func testOldScubaSessionAdaptsWithUnknownSafetyStop() {
        let old = DiveSession(
            diveMode: .scuba,
            gasLabel: "Air",
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(1200),
            samples: [
                EngineTestFixtures.sample(0, depth: 0),
                EngineTestFixtures.sample(60, depth: 21.2),
                EngineTestFixtures.sample(1200, depth: 0)
            ]
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .scuba(session) = record.payload else {
            return XCTFail("Expected scuba payload")
        }
        XCTAssertEqual(session.gasLabel, "Air")
        XCTAssertEqual(session.safetyStop.status, .unknown)
    }
}
